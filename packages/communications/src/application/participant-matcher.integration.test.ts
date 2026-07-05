// Live-DB integration test for the participant matcher. Exercises every
// branch of `match()` — exact contact, ambiguous, company-by-domain,
// contact creation, no-match, and organization isolation — against a real
// Postgres so the SQL (contact_channels join, company domain fallback,
// createPolicy inserts) is covered rather than mocked.
//
// Prereq: Postgres reachable on $DATABASE_URL with the current schema
// (the integration config's globalSetup builds `batuda_it`).

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { PgClient } from '@effect/sql-pg'
import { Config, Effect, Redacted } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/domain'

import { type MatchArgs, ParticipantMatcher } from './participant-matcher.js'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const camelToSnake = (s: string) =>
	s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)

const PgLive = PgClient.layerConfig({
	url: Config.succeed(Redacted.make(DATABASE_URL)),
	transformResultNames: Config.succeed(snakeToCamel),
	transformQueryNames: Config.succeed(camelToSnake),
})

// Two orgs so the isolation case can seed a colliding address in a neighbour
// org that must never match.
const ORG_ID = `test-org-${randomUUID()}`
const OTHER_ORG_ID = `test-org-${randomUUID()}`
const ACME_DOMAIN = `acme-${randomUUID()}.example`

let pool: pg.Pool
let acmeCompanyId: string
let aliceContactId: string

const runMatch = (args: MatchArgs, orgId: string = ORG_ID) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const matcher = yield* ParticipantMatcher
			return yield* matcher.match(args)
		}).pipe(
			Effect.provideService(CurrentOrg, { id: orgId, name: '', slug: '' }),
			Effect.provide(ParticipantMatcher.layer),
			Effect.provide(PgLive),
		),
	)

const insertCompany = async (
	orgId: string,
	slug: string,
	email: string,
): Promise<string> => {
	const result = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, email) VALUES ($1, $2, $3, $4) RETURNING id`,
		[orgId, slug, slug, email],
	)
	const row = result.rows[0]
	if (!row) throw new Error(`failed to insert company ${slug}`)
	return row.id
}

const insertContact = async (
	orgId: string,
	companyId: string,
	name: string,
	address: string,
): Promise<string> => {
	const result = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`,
		[orgId, companyId, name],
	)
	const row = result.rows[0]
	if (!row) throw new Error(`failed to insert contact ${name}`)
	// The address lives on the email channel — that's what the matcher joins.
	await pool.query(
		`INSERT INTO contact_channels (organization_id, contact_id, channel, address, is_primary) VALUES ($1, $2, 'email', $3, true)`,
		[orgId, row.id, address],
	)
	return row.id
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	acmeCompanyId = await insertCompany(
		ORG_ID,
		`acme-${randomUUID()}`,
		`info@${ACME_DOMAIN}`,
	)
	aliceContactId = await insertContact(
		ORG_ID,
		acmeCompanyId,
		'Alice',
		`alice@${ACME_DOMAIN}`,
	)
}, 30_000)

afterAll(async () => {
	// Child rows before parents (no CASCADE on every FK).
	for (const org of [ORG_ID, OTHER_ORG_ID]) {
		await pool.query(
			`DELETE FROM contact_channels WHERE organization_id = $1`,
			[org],
		)
		await pool.query(`DELETE FROM contacts WHERE organization_id = $1`, [org])
		await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [org])
	}
	await pool.end()
})

describe('ParticipantMatcher', () => {
	describe('when the address matches exactly one contact', () => {
		it('should return MatchedContact with that contact and its company', async () => {
			// GIVEN a seeded contact alice@acme on the email channel
			// WHEN we match her address
			const match = await runMatch({
				channel: 'email',
				address: `alice@${ACME_DOMAIN}`,
				createPolicy: 'never',
			})
			// THEN the exact contact + company are returned
			expect(match._tag).toBe('MatchedContact')
			if (match._tag === 'MatchedContact') {
				expect(match.contactId).toBe(aliceContactId)
				expect(match.companyId).toBe(acmeCompanyId)
			}
		})

		it('should match case-insensitively on the address', async () => {
			// GIVEN the same seeded contact
			// WHEN matched with an upper-cased address
			const match = await runMatch({
				channel: 'email',
				address: `ALICE@${ACME_DOMAIN.toUpperCase()}`,
				createPolicy: 'never',
			})
			// THEN it still resolves to her (the join lower()s both sides)
			expect(match._tag).toBe('MatchedContact')
		})
	})

	describe('when the address matches two contacts', () => {
		it('should return Ambiguous with every candidate and create nothing', async () => {
			// GIVEN one address shared by two contacts (duplicate-data state)
			const dupeAddress = `dupe-${randomUUID()}@${ACME_DOMAIN}`
			await insertContact(ORG_ID, acmeCompanyId, 'Dupe One', dupeAddress)
			const otherCompany = await insertCompany(
				ORG_ID,
				`other-${randomUUID()}`,
				`info@other.example`,
			)
			await insertContact(ORG_ID, otherCompany, 'Dupe Two', dupeAddress)

			// WHEN matched
			const match = await runMatch({
				channel: 'email',
				address: dupeAddress,
				createPolicy: 'both',
			})

			// THEN neither is chosen; both candidates are surfaced
			expect(match._tag).toBe('Ambiguous')
			if (match._tag === 'Ambiguous') {
				expect(match.candidates.length).toBe(2)
			}
		})
	})

	describe('when no contact matches but the email domain matches a company', () => {
		describe('and createPolicy is "never"', () => {
			it('should return MatchedCompanyOnly and create no contact', async () => {
				// GIVEN no contact for stranger@acme but the domain matches Acme
				const address = `stranger-${randomUUID()}@${ACME_DOMAIN}`
				// WHEN matched read-only
				const match = await runMatch({
					channel: 'email',
					address,
					createPolicy: 'never',
				})
				// THEN only the company resolves
				expect(match._tag).toBe('MatchedCompanyOnly')
				if (match._tag === 'MatchedCompanyOnly') {
					expect(match.companyId).toBe(acmeCompanyId)
				}
				// AND no channel row was written for that address
				const written = await pool.query(
					`SELECT 1 FROM contact_channels WHERE organization_id = $1 AND lower(address) = $2`,
					[ORG_ID, address.toLowerCase()],
				)
				expect(written.rowCount).toBe(0)
			})
		})

		describe('and createPolicy is "contact-only"', () => {
			it('should create a contact under the company and persist its channel', async () => {
				// GIVEN no contact for newbie@acme but the domain matches Acme
				const address = `newbie-${randomUUID()}@${ACME_DOMAIN}`
				// WHEN matched with a create policy
				const match = await runMatch({
					channel: 'email',
					address,
					displayName: 'Newbie',
					createPolicy: 'contact-only',
				})
				// THEN a contact is created under Acme
				expect(match._tag).toBe('CreatedContact')
				if (match._tag === 'CreatedContact') {
					expect(match.companyId).toBe(acmeCompanyId)
				}
				// AND the address is now a primary email channel, so a later
				// read-only match resolves it directly as MatchedContact
				const again = await runMatch({
					channel: 'email',
					address,
					createPolicy: 'never',
				})
				expect(again._tag).toBe('MatchedContact')
			})
		})
	})

	describe('when the address has no domain', () => {
		it('should return NoMatch carrying the channel and address', async () => {
			// GIVEN an address with no @ (nothing to fall back to)
			// WHEN matched
			const match = await runMatch({
				channel: 'email',
				address: 'no-at-sign',
				createPolicy: 'both',
			})
			// THEN NoMatch, echoing what was searched
			expect(match._tag).toBe('NoMatch')
			if (match._tag === 'NoMatch') {
				expect(match.channel).toBe('email')
				expect(match.address).toBe('no-at-sign')
			}
		})
	})

	describe('when the domain matches no company', () => {
		it('should return NoMatch', async () => {
			// GIVEN an address whose domain matches neither a contact nor a company
			// WHEN matched
			const match = await runMatch({
				channel: 'email',
				address: `someone@unclaimed-${randomUUID()}.example`,
				createPolicy: 'both',
			})
			// THEN NoMatch
			expect(match._tag).toBe('NoMatch')
		})
	})

	describe('when a contact with the same address belongs to another org', () => {
		it('should return NoMatch — matches are scoped to the current org', async () => {
			// GIVEN carol@neighbour seeded under a DIFFERENT org
			const neighbourDomain = `neighbour-${randomUUID()}.example`
			const address = `carol@${neighbourDomain}`
			const otherCompany = await insertCompany(
				OTHER_ORG_ID,
				`neighbour-${randomUUID()}`,
				`info@${neighbourDomain}`,
			)
			await insertContact(OTHER_ORG_ID, otherCompany, 'Carol', address)
			// WHEN we match that address as ORG_ID
			const match = await runMatch(
				{ channel: 'email', address, createPolicy: 'never' },
				ORG_ID,
			)
			// THEN the neighbour's contact + company are invisible → NoMatch
			expect(match._tag).toBe('NoMatch')
		})
	})
})
