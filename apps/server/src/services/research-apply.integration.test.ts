// Live-DB integration test for the research apply path's confidence
// normalization and duplicate-contact guard — the parts that need real SQL
// (the whole-number column, the (kind, value) lookup, org-scoped queries).
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { writeChannels } from './channels'
import { findDuplicateContact } from './research-apply'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = `apply-org-${randomUUID()}`
// A second tenant, to prove the guard never matches across organizations.
const OTHER_ORG = `apply-other-${randomUUID()}`

let pool: pg.Pool

const seedCompany = async (org = ORG): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[org, `acme-${randomUUID()}`],
	)
	return r.rows[0]?.id ?? ''
}

const seedContact = async (
	companyId: string,
	name: string,
	org = ORG,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name)
		 VALUES ($1, $2, $3) RETURNING id`,
		[org, companyId, name],
	)
	return r.rows[0]?.id ?? ''
}

const seedChannel = (
	contactId: string,
	kind: string,
	value: string,
	org = ORG,
) =>
	pool.query(
		`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address)
		 VALUES ($1, 'contacts', $2, $3, $4)`,
		[org, contactId, kind, value],
	)

const dedup = (
	name: string,
	companyId: string,
	channels: ReadonlyArray<{ kind: string; value: string }>,
	discoveredExisting: ReadonlyArray<{
		subject_table?: string
		subject_id?: string
		name?: string
	}> = [],
	org = ORG,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* findDuplicateContact(
				sql,
				org,
				name,
				companyId,
				channels,
				discoveredExisting,
			)
		}),
	)

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	// contacts cascade from companies and channels are cleared alongside, so deleting the
	// companies clears everything both orgs seeded.
	await pool.query(
		`DELETE FROM companies WHERE organization_id = ANY($1::text[])`,
		[[ORG, OTHER_ORG]],
	)
	await runtime.dispose()
	await pool.end()
})

describe('writeChannels confidence normalization', () => {
	describe('when a channel carries a fractional (0–1) confidence', () => {
		it('should store it as a 0–100 whole number, not collapse it to 0/1', async () => {
			// GIVEN a discovered contact with a model-scored email channel
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Grace Hopper')

			// WHEN the channel is written through the apply path's writer
			await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* writeChannels(sql, ORG, { table: 'contacts', id: contactId }, [
						{ kind: 'email', value: 'grace@acme.es', confidence: 0.9 },
					])
				}),
			)

			// THEN the whole-number column holds 90, not a coerced 1
			const rows = await pool.query<{ confidence: number }>(
				`SELECT confidence FROM channels
				 WHERE subject_table = 'contacts' AND subject_id = $1 AND channel = 'email'`,
				[contactId],
			)
			expect(rows.rows[0]?.confidence).toBe(90)
		})
	})

	describe('when a channel already carries a 0–100 score (e.g. Hunter)', () => {
		it('should store it unchanged', async () => {
			// GIVEN an enrichment-scored channel already on the 0–100 scale
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Katherine Johnson')

			// WHEN it is written
			await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* writeChannels(sql, ORG, { table: 'contacts', id: contactId }, [
						{ kind: 'email', value: 'kat@acme.es', confidence: 85 },
					])
				}),
			)

			// THEN the score is preserved
			const rows = await pool.query<{ confidence: number }>(
				`SELECT confidence FROM channels
				 WHERE subject_table = 'contacts' AND subject_id = $1 AND channel = 'email'`,
				[contactId],
			)
			expect(rows.rows[0]?.confidence).toBe(85)
		})
	})

	describe('when a channel has no confidence', () => {
		it('should store null, leaving the column empty', async () => {
			// GIVEN a channel with no confidence signal
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Margaret Hamilton')

			// WHEN it is written
			await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* writeChannels(sql, ORG, { table: 'contacts', id: contactId }, [
						{ kind: 'linkedin', value: 'in/margaret' },
					])
				}),
			)

			// THEN the column stays empty rather than defaulting to a number
			const rows = await pool.query<{ confidence: number | null }>(
				`SELECT confidence FROM channels
				 WHERE subject_table = 'contacts' AND subject_id = $1 AND channel = 'linkedin'`,
				[contactId],
			)
			expect(rows.rows[0]?.confidence).toBeNull()
		})
	})
})

describe('findDuplicateContact', () => {
	describe('when an existing contact is reachable at a proposed channel value', () => {
		it('should return that contact so the same person is not created twice', async () => {
			// GIVEN a contact already reachable at an email
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Ada Lovelace')
			await seedChannel(contactId, 'email', 'ada@acme.es')

			// WHEN a create proposal carries the same email
			const found = await dedup('Ada L.', companyId, [
				{ kind: 'email', value: 'ada@acme.es' },
			])

			// THEN the existing contact is matched
			expect(found).toBe(contactId)
		})
	})

	describe('when one of several proposed channels matches', () => {
		it('should still find the contact', async () => {
			// GIVEN a contact reachable only at a phone number
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Ada')
			await seedChannel(contactId, 'phone', '+34600111222')

			// WHEN a proposal carries a fresh email plus that known phone
			const found = await dedup('Ada', companyId, [
				{ kind: 'email', value: 'new@acme.es' },
				{ kind: 'phone', value: '+34600111222' },
			])

			// THEN the known channel is enough to identify the person
			expect(found).toBe(contactId)
		})
	})

	describe('when only the kind differs on a shared value', () => {
		it('should not match, so a shared switchboard value cannot merge two people', async () => {
			// GIVEN a contact reachable at a phone number
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Ada')
			await seedChannel(contactId, 'phone', '+34999000111')

			// WHEN a different person's proposal reuses that value under another kind
			const found = await dedup('Bea', companyId, [
				{ kind: 'email', value: '+34999000111' },
			])

			// THEN it is not treated as the same person
			expect(found).toBeNull()
		})
	})

	describe('when the matching channel belongs to another organization', () => {
		it('should not match across the org boundary', async () => {
			// GIVEN a contact in another org reachable at an email
			const otherCompany = await seedCompany(OTHER_ORG)
			const otherContact = await seedContact(otherCompany, 'Ada', OTHER_ORG)
			await seedChannel(otherContact, 'email', 'shared@acme.es', OTHER_ORG)
			const companyId = await seedCompany()

			// WHEN this org proposes the same email
			const found = await dedup('Ada', companyId, [
				{ kind: 'email', value: 'shared@acme.es' },
			])

			// THEN the other org's contact is invisible here
			expect(found).toBeNull()
		})
	})

	describe('when no channel matches but the name and company do', () => {
		it('should match case-insensitively on name within the company', async () => {
			// GIVEN a contact with no channels
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Ada Lovelace')

			// WHEN a proposal has the same name in a different case and no channels
			const found = await dedup('ada lovelace', companyId, [])

			// THEN the name + company still identify the same person
			expect(found).toBe(contactId)
		})
	})

	describe('when the same name exists but under a different company', () => {
		it('should not match, since a namesake at another company is a different person', async () => {
			// GIVEN a contact under one company
			const companyA = await seedCompany()
			await seedContact(companyA, 'John Smith')
			const companyB = await seedCompany()

			// WHEN the proposal names the same person under a different company
			const found = await dedup('John Smith', companyB, [])

			// THEN the namesake is left alone
			expect(found).toBeNull()
		})
	})

	describe('when the model flags the contact as already existing', () => {
		it('should match on the discovered_existing entry by name', async () => {
			// GIVEN a contact the model separately listed as already known
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId, 'Alan Turing')
			// A different company on the proposal, so only the flag can match it
			const otherCompany = await seedCompany()

			// WHEN the proposal's discovered_existing points at that contact
			const found = await dedup(
				'Alan Turing',
				otherCompany,
				[],
				[
					{
						subject_table: 'contacts',
						subject_id: contactId,
						name: 'Alan Turing',
					},
				],
			)

			// THEN the flagged row is matched
			expect(found).toBe(contactId)
		})
	})

	describe('when the flag targets a company rather than a contact', () => {
		it('should ignore it', async () => {
			// GIVEN a flag that names a company subject
			const companyId = await seedCompany()

			// WHEN it is checked
			const found = await dedup(
				'Whoever',
				companyId,
				[],
				[
					{
						subject_table: 'companies',
						subject_id: companyId,
						name: 'Whoever',
					},
				],
			)

			// THEN a company flag never identifies a contact
			expect(found).toBeNull()
		})
	})

	describe('when the flag targets a contact in another organization', () => {
		it('should not match it', async () => {
			// GIVEN a flag pointing at another org's contact id
			const otherCompany = await seedCompany(OTHER_ORG)
			const otherContact = await seedContact(otherCompany, 'Grace', OTHER_ORG)
			const companyId = await seedCompany()

			// WHEN this org resolves the flag
			const found = await dedup(
				'Grace',
				companyId,
				[],
				[
					{
						subject_table: 'contacts',
						subject_id: otherContact,
						name: 'Grace',
					},
				],
			)

			// THEN the cross-org id is not honored
			expect(found).toBeNull()
		})
	})

	describe('when the flagged subject_id is not a UUID', () => {
		it('should treat it as no match rather than erroring on the bad id', async () => {
			// GIVEN a hallucinated non-UUID id in discovered_existing
			const companyId = await seedCompany()

			// WHEN it is looked up
			const found = await dedup(
				'Ghost',
				companyId,
				[],
				[
					{
						subject_table: 'contacts',
						subject_id: 'not-a-uuid',
						name: 'Ghost',
					},
				],
			)

			// THEN the bad id is simply no match, not a crash
			expect(found).toBeNull()
		})
	})

	describe('when a channel and a name point at different contacts', () => {
		it('should prefer the channel match, the stronger signal', async () => {
			// GIVEN one contact reachable at an email and another sharing the
			// proposed name under the same company
			const companyId = await seedCompany()
			const byChannel = await seedContact(companyId, 'Reachable One')
			await seedChannel(byChannel, 'email', 'reach@acme.es')
			await seedContact(companyId, 'Zed')

			// WHEN a proposal named "Zed" also carries the known email
			const found = await dedup('Zed', companyId, [
				{ kind: 'email', value: 'reach@acme.es' },
			])

			// THEN the channel match wins over the name match
			expect(found).toBe(byChannel)
		})
	})

	describe('when nothing matches', () => {
		it('should return null so a fresh contact is created', async () => {
			// GIVEN an org with no matching contact
			const companyId = await seedCompany()

			// WHEN a brand-new person is proposed
			const found = await dedup('Nobody Here', companyId, [
				{ kind: 'email', value: 'nobody@acme.es' },
			])

			// THEN there is no duplicate to reuse
			expect(found).toBeNull()
		})
	})
})
