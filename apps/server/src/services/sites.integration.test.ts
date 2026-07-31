// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { ownedSiteId } from './sites'

// What stops a person being filed under somebody else's shop.
//
// The foreign key on `contacts.site_id` says the branch exists; it does not say
// whose it is, or that it belongs to the company the person works for. That gap
// is closed in code, so it is worth pinning: a branch from another organisation
// and a branch of a different company are both dropped, while the person is
// still recorded — the branch is the guess, not the person.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `owned-site-${randomUUID()}`
const OTHER_ORG = `other-org-${randomUUID()}`
let company: string
let ownSite: string
let otherCompanySite: string
let otherOrgSite: string

const seedCompany = async (org: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Company') RETURNING id`,
		[org, `co-${randomUUID()}`],
	)
	return r.rows[0]!.id
}

const seedSite = async (org: string, companyId: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO sites (organization_id, company_id, name)
		 VALUES ($1, $2, 'Branch') RETURNING id`,
		[org, companyId],
	)
	return r.rows[0]!.id
}

// The helper takes a resolved SqlClient, so the test provides the app's own —
// same name conversion, so a mismatch there would show up here too.
const check = (siteId: string | null | undefined) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* ownedSiteId(sql, ORG, company, siteId)
	}).pipe(Effect.provide(PgLive), Effect.runPromise)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	company = await seedCompany(ORG)
	ownSite = await seedSite(ORG, company)
	const sibling = await seedCompany(ORG)
	otherCompanySite = await seedSite(ORG, sibling)
	const foreign = await seedCompany(OTHER_ORG)
	otherOrgSite = await seedSite(OTHER_ORG, foreign)
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE organization_id = ANY($1)`, [
		[ORG, OTHER_ORG],
	])
	await pool.end()
})

describe('checking the branch named for a person', () => {
	describe("when the branch is the company's own", () => {
		it('should keep it', async () => {
			// GIVEN a branch of the company this person works for
			// WHEN it is checked
			// THEN it is kept as given
			await expect(check(ownSite)).resolves.toBe(ownSite)
		})
	})

	describe('when the branch belongs to another organisation', () => {
		it('should say nothing rather than file the person under it', async () => {
			// GIVEN a branch nobody in this organisation can see
			// WHEN it is checked
			// THEN it answers "say nothing", so a branch already recorded survives
			await expect(check(otherOrgSite)).resolves.toBeUndefined()
		})
	})

	describe('when the branch belongs to a different company in the same org', () => {
		it('should say nothing — visible is not the same as theirs', async () => {
			// GIVEN a branch of a company this person does not work for
			// WHEN it is checked
			// THEN it answers "say nothing"
			await expect(check(otherCompanySite)).resolves.toBeUndefined()
		})
	})

	describe('when the branch does not exist at all', () => {
		it('should say nothing', async () => {
			// GIVEN an id matching no branch — a typo, or one since closed
			// WHEN it is checked
			// THEN it answers "say nothing" rather than clearing a good branch
			await expect(check(randomUUID())).resolves.toBeUndefined()
		})
	})

	describe('when the caller said nothing about a branch', () => {
		it('should leave the stored value alone', async () => {
			// GIVEN a caller changing something else entirely
			// WHEN no branch is named
			// THEN the answer is "do not touch", which is not the same as clearing it
			await expect(check(undefined)).resolves.toBeUndefined()
		})
	})

	describe('when the caller clears the branch', () => {
		it('should clear it without a lookup', async () => {
			// GIVEN somebody who no longer works at any one branch
			// WHEN null is passed
			// THEN it clears, rather than being treated as an unknown branch
			await expect(check(null)).resolves.toBeNull()
		})
	})
})
