// Live-DB integration test for finding a company whose name carries an accent.
//
// An accented letter can be written two ways and the two do not match each other:
// é is either one character, or an e with a mark added after it. A browser hands
// over the first, a Mac hands over the second, and a name scraped off a page can be
// either. So the same word typed twice found a company once and nothing the other
// time, with no way for the person searching to tell why.
//
// A live database on purpose: what is pinned down is how Postgres compares the
// two forms, which is the half no unit test can reach.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

const TAG = `accents-${randomUUID().slice(0, 8)}`

// The same name written both ways: the accent joined onto the letter, and the
// accent left as a mark of its own after the letter.
const JOINED = 'Calderería Sentmenat'.normalize('NFC')
const APART = 'Calderería Sentmenat'.normalize('NFD')

let pool: pg.Pool
let orgId: string

const deps = CompanyService.layer.pipe(Layer.provideMerge(PgLive))

// Read the way a request does: role app_user, scoped to this org, so row-level
// security applies exactly as it would in production.
const searchFor = (query: string): Promise<ReadonlyArray<string>> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const companies = yield* CompanyService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				const page = yield* companies.search({ query, limit: 50 }).pipe(
					Effect.provideService(CurrentOrg, {
						id: orgId,
						name: 'fixture',
						slug: 'fixture',
						role: 'member' as const,
					}),
				)
				return page.items
					.map(row => row.name)
					.filter(name => name.includes(TAG))
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const insertCompany = async (name: string, slug: string): Promise<void> => {
	await pool.query(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, $3, 'prospect')`,
		[orgId, slug, name],
	)
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const orgs = await pool.query<{ id: string }>(
		`SELECT id FROM organization ORDER BY id LIMIT 1`,
	)
	const first = orgs.rows[0]?.id
	if (first === undefined)
		throw new Error('an organization must be seeded — run the setup')
	orgId = first
	// One company stored with the accent joined on, one with it written apart —
	// both shapes really do arrive, so both have to be findable.
	await insertCompany(`${JOINED} ${TAG} joined`, `${TAG}-joined`)
	await insertCompany(`${APART} ${TAG} apart`, `${TAG}-apart`)
})

afterAll(async () => {
	await pool.query('DELETE FROM companies WHERE slug LIKE $1', [`${TAG}%`])
	await pool.end()
})

describe('searching for a company whose name carries an accent', () => {
	describe('when the search is typed with the accent joined on', () => {
		it('should find it however the stored name was written', async () => {
			// GIVEN two companies, one stored each way
			// WHEN the accented word is typed the joined way, as a browser sends it
			// THEN both come back — a company stored the other way is not a miss
			const found = await searchFor('Calderería'.normalize('NFC'))
			expect(found).toHaveLength(2)
		})
	})

	describe('when the search is typed with the accent written apart', () => {
		it('should find it however the stored name was written', async () => {
			// GIVEN the same two companies
			// WHEN the word is pasted the way a Mac writes it
			// THEN both still come back — this is the direction somebody hit while
			// pasting a name out of a file
			const found = await searchFor('Calderería'.normalize('NFD'))
			expect(found).toHaveLength(2)
		})
	})

	describe('when the search names a different company', () => {
		it('should still find nothing', async () => {
			// GIVEN a word neither company is called
			// WHEN searched
			// THEN nothing. Reading the two forms alike must not make everything alike
			const found = await searchFor(`Fusteria ${TAG}`)
			expect(found).toEqual([])
		})
	})
})
