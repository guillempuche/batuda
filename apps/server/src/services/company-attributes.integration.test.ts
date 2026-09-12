// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Result } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AttributeRejected, CurrentOrg } from '@batuda/controllers'
import { listActiveAttributes } from '@batuda/instructions'
import { makeWorkRecord, WorkRecord } from '@batuda/observability'

import { PgLive } from '../db/client'
import { enterOrgScope } from '../middleware/org'
import { type CompanyFilters, CompanyService } from './companies'

// The attribute values on a company row, written and searched through the
// company service the way every door reaches it: a value under a declared key
// merges into the column, a person's edit drops the note a run left, a filter
// compares a value the way its kind allows, and a value that got in under an
// earlier meaning of a key never fails a list.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

const suffix = randomUUID().slice(0, 8)
const ORG = `attr-svc-${suffix}`
const OTHER_ORG = `attr-svc-other-${suffix}`
const org = { id: ORG, name: 'a', slug: ORG }

// Keys unique to this suite, so nothing declared elsewhere in the shared
// database can answer for them.
const SITES = `sites_${suffix}`
const FOUNDED = `founded_${suffix}`
const CRM = `crm_${suffix}`
const FRANCHISE = `franchise_${suffix}`
const FIT = `fit_${suffix}`

let pool: pg.Pool

const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

type Scope = typeof org

// Runs a service call inside an organisation's scope, as a request does.
const inOrg = <A, E>(
	scope: Scope,
	body: (svc: CompanyService['Service']) => Effect.Effect<A, E, CurrentOrg>,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org: scope })(body(service))
		}).pipe(Effect.orDie),
	)

// The same, keeping a refusal as a value the test can read.
const attempt = <A, E>(
	scope: Scope,
	body: (svc: CompanyService['Service']) => Effect.Effect<A, E, CurrentOrg>,
): Promise<Result.Result<A, E>> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org: scope })(
				Effect.result(body(service)),
			)
		}).pipe(Effect.orDie),
	)

// The same again, with the request's record open, so a test can read the
// facts a refusal leaves on it.
const attemptRecorded = <A, E>(
	scope: Scope,
	body: (svc: CompanyService['Service']) => Effect.Effect<A, E, CurrentOrg>,
): Promise<{ outcome: Result.Result<A, E>; facts: Record<string, unknown> }> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			const record = yield* makeWorkRecord
			const outcome = yield* enterOrgScope(sql, { org: scope })(
				Effect.result(body(service)),
			).pipe(Effect.provideService(WorkRecord, record))
			return { outcome, facts: yield* record.read }
		}).pipe(Effect.orDie),
	)

const refusal = <A>(
	outcome: Result.Result<A, unknown>,
): AttributeRejected | null =>
	Result.isFailure(outcome) &&
	typeof outcome.failure === 'object' &&
	outcome.failure !== null &&
	'_tag' in outcome.failure &&
	outcome.failure._tag === 'AttributeRejected'
		? (outcome.failure as AttributeRejected)
		: null

const declare = async (
	orgId: string,
	stackId: string,
	key: string,
	kind: string,
	enumValues: ReadonlyArray<string> | null = null,
	unit: string | null = null,
) =>
	pool.query(
		`INSERT INTO research_attributes (organization_id, stack_id, key, label, kind, enum_values, unit, created_by)
		 VALUES ($1, $2, $3, $3, $4, $5, $6, 'u1')`,
		[orgId, stackId, key, kind, enumValues, unit],
	)

const seedCompany = async (
	orgId: string,
	attributes: Record<string, unknown> = {},
	provenance: Record<string, unknown> | null = null,
	country = 'ES',
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, country, attributes, field_provenance)
		 VALUES ($1, $2, $2, $3, $4::jsonb, $5::jsonb) RETURNING id`,
		[
			orgId,
			`co-${randomUUID()}`,
			country,
			JSON.stringify(attributes),
			provenance === null ? null : JSON.stringify(provenance),
		],
	)
	return r.rows[0]?.id as string
}

const readRow = async (id: string) => {
	const r = await pool.query<{
		attributes: Record<string, unknown>
		field_provenance: Record<string, unknown> | null
		version: number
		name: string
	}>(
		`SELECT attributes, field_provenance, version, name FROM companies WHERE id = $1`,
		[id],
	)
	return r.rows[0] as NonNullable<(typeof r.rows)[0]>
}

// A run of this organisation that fetched one page, so a citation of that page
// resolves and any other does not.
const seedRunWithPage = async (
	orgId: string,
	url: string,
): Promise<{ runId: string; sourceId: string }> => {
	const sourceId = `src_${randomUUID().slice(0, 8)}`
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'test', $2, $3, 'acme.example', $4)`,
		[sourceId, url, `hash-${randomUUID()}`, `content-${randomUUID()}`],
	)
	const run = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by)
		 VALUES ($1, 'q', 'succeeded', 'u1') RETURNING id`,
		[orgId],
	)
	const runId = run.rows[0]?.id as string
	await pool.query(
		`INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents)
		 VALUES ($1, $2, $3, $4, now(), 0)`,
		[orgId, runId, sourceId, url],
	)
	return { runId, sourceId }
}

const idsIn = (result: { items: ReadonlyArray<{ id: string }> }) =>
	result.items.map(c => c.id)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const stack = async (orgId: string) =>
		(
			await pool.query<{ id: string }>(
				`INSERT INTO instruction_stacks (organization_id, owner_user_id, agent, name, is_default)
				 VALUES ($1, NULL, 'research', $2, true) RETURNING id`,
				[orgId, `st-${suffix}`],
			)
		).rows[0]?.id as string
	const mine = await stack(ORG)
	await declare(ORG, mine, SITES, 'number', null, 'sites')
	await declare(ORG, mine, FOUNDED, 'date')
	await declare(ORG, mine, CRM, 'text')
	await declare(ORG, mine, FRANCHISE, 'boolean')
	await declare(ORG, mine, FIT, 'enum', ['strong', 'possible', 'no'])
	// The other organisation declares the sites key too, as text: what it
	// declares must never reach this organisation's writes or filters.
	const theirs = await stack(OTHER_ORG)
	await declare(OTHER_ORG, theirs, SITES, 'text')
}, 30_000)

afterAll(async () => {
	for (const orgId of [ORG, OTHER_ORG]) {
		await pool.query(
			`DELETE FROM research_run_sources WHERE organization_id = $1`,
			[orgId],
		)
		await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
			orgId,
		])
		await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [
			orgId,
		])
		await pool.query(
			`DELETE FROM instruction_stacks WHERE organization_id = $1`,
			[orgId],
		)
	}
	await pool.query(
		`DELETE FROM sources WHERE provider = 'test' AND domain = 'acme.example' AND url LIKE $1`,
		[`%${suffix}%`],
	)
	await pool.end()
	await runtime.dispose()
})

describe('writing attribute values through update', () => {
	describe('when the update names no attributes', () => {
		it('should leave the column and the provenance exactly as they were', async () => {
			// GIVEN a row holding two keys and a note for one of them
			const held = {
				[SITES]: { value: 2, set_by: 'client' },
				[CRM]: { value: 'zoho', set_by: 'client' },
			}
			const notes = {
				[`attributes.${SITES}`]: { sourceUrl: 'https://x', runId: 'r' },
				website: { sourceUrl: 'https://y', runId: 'r' },
			}
			const id = await seedCompany(ORG, held, notes)

			// WHEN only the name changes
			await inOrg(org, svc => svc.update(id, { name: 'Renamed' }))

			// THEN both columns are as they were and the version moved
			const row = await readRow(id)
			expect(row.attributes).toEqual(held)
			expect(row.field_provenance).toEqual(notes)
			expect(row.name).toBe('Renamed')
			expect(row.version).toBe(1)
		})
	})

	describe('when a run id comes with no values', () => {
		it('should change the other fields and ask nothing about the run', async () => {
			// GIVEN a row, and a run id that names no run at all
			const id = await seedCompany(ORG, {
				[SITES]: { value: 2, set_by: 'client' },
			})

			// WHEN only the name changes, with the run id beside it
			await inOrg(org, svc =>
				svc.update(id, { name: 'Renamed', researchId: 'not-a-run' }),
			)

			// THEN the write went through and the column is as it was
			const row = await readRow(id)
			expect(row.name).toBe('Renamed')
			expect(row.attributes).toEqual({
				[SITES]: { value: 2, set_by: 'client' },
			})
		})
	})

	describe('when the update names one key', () => {
		it('should merge into the column rather than replace it', async () => {
			// GIVEN two keys held
			const id = await seedCompany(ORG, {
				[SITES]: { value: 2, set_by: 'client' },
				[CRM]: { value: 'zoho', set_by: 'client' },
			})

			// WHEN one is written, as text that reads as a number
			await inOrg(org, svc => svc.update(id, { attributes: { [SITES]: '5' } }))

			// THEN the other survives and the written one is stored as a number
			expect((await readRow(id)).attributes).toEqual({
				[SITES]: { value: 5, set_by: 'client' },
				[CRM]: { value: 'zoho', set_by: 'client' },
			})
		})
	})

	describe('when a key is set to null', () => {
		it('should remove the key and its note, declared or not, keeping other notes', async () => {
			// GIVEN a key a run set, with its note, and a key nobody declares any more
			const id = await seedCompany(
				ORG,
				{
					[SITES]: { value: 2, set_by: 'research', research_id: 'r' },
					retired_key: { value: 'x', set_by: 'client' },
				},
				{
					[`attributes.${SITES}`]: { sourceUrl: 'https://x', runId: 'r' },
					website: { sourceUrl: 'https://y', runId: 'r' },
				},
			)

			// WHEN both are set to null
			await inOrg(org, svc =>
				svc.update(id, { attributes: { [SITES]: null, retired_key: null } }),
			)

			// THEN both keys and the attribute note are gone, the other note stays
			const row = await readRow(id)
			expect(row.attributes).toEqual({})
			expect(row.field_provenance).toEqual({
				website: { sourceUrl: 'https://y', runId: 'r' },
			})
		})
	})

	describe('when a person overwrites a value a run set', () => {
		it("should stamp it as the person's and drop the run's note", async () => {
			// GIVEN a value set by a run with a note
			const id = await seedCompany(
				ORG,
				{
					[SITES]: {
						value: 2,
						set_by: 'research',
						research_id: 'r',
						source_url: 'https://x',
					},
				},
				{ [`attributes.${SITES}`]: { sourceUrl: 'https://x', runId: 'r' } },
			)

			// WHEN a person writes the key with no run named
			await inOrg(org, svc => svc.update(id, { attributes: { [SITES]: 7 } }))

			// THEN the value is the person's, without the run's fields or note
			const row = await readRow(id)
			expect(row.attributes).toEqual({
				[SITES]: { value: 7, set_by: 'client' },
			})
			expect(row.field_provenance).toEqual({})
		})
	})

	describe('when the write is refused', () => {
		it('should name an undeclared key and leave the row untouched, version included', async () => {
			// GIVEN a write with a new name and a key nobody declared
			const id = await seedCompany(ORG)

			// WHEN it is written
			const outcome = await attempt(org, svc =>
				svc.update(id, { name: 'X', attributes: { nobody_declared: 1 } }),
			)

			// THEN the refusal names the key and nothing moved
			expect(refusal(outcome)).toMatchObject({
				reason: 'undeclared_key',
				key: 'nobody_declared',
			})
			const row = await readRow(id)
			expect(row.name).not.toBe('X')
			expect(row.version).toBe(0)
		})

		it("should put the reason on the request's record", async () => {
			// GIVEN a write under a key nobody declared
			const id = await seedCompany(ORG)
			// WHEN it is refused
			const { outcome, facts } = await attemptRecorded(org, svc =>
				svc.update(id, { attributes: { nobody_declared: 1 } }),
			)
			// THEN the record carries the reason as a code, beside the refusal
			expect(refusal(outcome)?.reason).toBe('undeclared_key')
			expect(facts['attribute.refused.reason']).toBe('undeclared_key')
		})

		it('should name the first key whose value does not read as its kind', async () => {
			// GIVEN a good value followed by one of the wrong kind
			const id = await seedCompany(ORG)

			// WHEN written
			const outcome = await attempt(org, svc =>
				svc.update(id, { attributes: { [CRM]: 'zoho', [SITES]: 'many' } }),
			)

			// THEN the refusal names the bad key
			expect(refusal(outcome)).toMatchObject({
				reason: 'wrong_kind',
				key: SITES,
			})
		})

		it("should not let another organisation's declaration authorise a write", async () => {
			// GIVEN a key only the other organisation declares
			const id = await seedCompany(ORG)
			const outcome = await attempt(org, svc =>
				svc.update(id, { attributes: { [`only_theirs_${suffix}`]: 'x' } }),
			)
			// THEN it is undeclared here
			expect(refusal(outcome)).toMatchObject({ reason: 'undeclared_key' })
		})
	})

	describe('when a run is named', () => {
		it("should refuse a run that is not this organisation's, or not a run id at all", async () => {
			// GIVEN a run of the other organisation, a fresh id, and text that is no id
			const id = await seedCompany(ORG)
			const theirs = await seedRunWithPage(
				OTHER_ORG,
				`https://acme.example/${suffix}/theirs`,
			)

			// WHEN each is named with a value
			for (const researchId of [theirs.runId, randomUUID(), 'run-1']) {
				const outcome = await attempt(org, svc =>
					svc.update(id, { attributes: { [SITES]: 3 }, researchId }),
				)
				// THEN the run is unknown here
				expect(refusal(outcome)).toMatchObject({
					reason: 'unknown_run',
					key: null,
				})
			}
		})

		it("should record a value as the run's only when the run fetched the page it cites", async () => {
			// GIVEN a run of this organisation that fetched one page
			const id = await seedCompany(ORG)
			const page = `https://acme.example/${suffix}/sites`
			const { runId, sourceId } = await seedRunWithPage(ORG, page)

			// WHEN two values are written: one citing that page by the run's id for
			// it, one citing a page the run never opened
			await inOrg(org, svc =>
				svc.update(id, {
					researchId: runId,
					attributes: {
						[SITES]: {
							value: 3,
							source_id: sourceId,
							quote: 'three sites',
							as_of: '2026-01-02',
						},
						[CRM]: { value: 'zoho', source_id: 'https://elsewhere.example/z' },
					},
				}),
			)

			// THEN the first is the run's, with the page's address and a note;
			// the second is the person's, keeping the address it named
			const row = await readRow(id)
			expect(row.attributes).toEqual({
				[SITES]: {
					value: 3,
					source_url: page,
					quote: 'three sites',
					as_of: '2026-01-02',
					research_id: runId,
					set_by: 'research',
				},
				[CRM]: {
					value: 'zoho',
					source_url: 'https://elsewhere.example/z',
					set_by: 'client',
				},
			})
			expect(row.field_provenance).toEqual({
				[`attributes.${SITES}`]: { sourceUrl: page, runId, asOf: '2026-01-02' },
			})
		})
	})
})

describe('writing attribute values through create', () => {
	describe('when a new company is created with values', () => {
		it("should start the column at the values and keep the run's note", async () => {
			// GIVEN a run that fetched a page
			const page = `https://acme.example/${suffix}/new`
			const { runId, sourceId } = await seedRunWithPage(ORG, page)

			// WHEN a company is created with one value citing it and one bare
			const result = await inOrg(org, svc =>
				svc.createWithContacts({
					company: {
						name: `New ${suffix}`,
						slug: `new-${suffix}`,
						researchId: runId,
						attributes: {
							[SITES]: { value: 4, source_id: sourceId },
							[FRANCHISE]: 'yes',
						},
					},
					contacts: [],
				}),
			)

			// THEN both land, one as the run's and one as the caller's
			expect(result.created).toBe(true)
			const row = await readRow(result.company.id)
			expect(row.attributes).toEqual({
				[SITES]: {
					value: 4,
					source_url: page,
					research_id: runId,
					set_by: 'research',
				},
				[FRANCHISE]: { value: true, set_by: 'client' },
			})
			expect(row.field_provenance).toEqual({
				[`attributes.${SITES}`]: { sourceUrl: page, runId },
			})
		})
	})

	describe('when the company is already on file', () => {
		it('should still refuse an undeclared key, and otherwise leave what the company holds', async () => {
			// GIVEN a company on file with a value
			const slug = `onfile-${suffix}`
			const existing = await inOrg(org, svc =>
				svc.createWithContacts({
					company: { name: slug, slug, attributes: { [SITES]: 1 } },
					contacts: [],
				}),
			)

			// WHEN it is offered again with an undeclared key
			const refused = await attempt(org, svc =>
				svc.createWithContacts({
					company: { name: slug, slug, attributes: { nobody_declared: 1 } },
					contacts: [],
				}),
			)
			// THEN the refusal is the same as for a new company
			expect(refusal(refused)).toMatchObject({ reason: 'undeclared_key' })

			// WHEN it is offered again with a valid value
			const again = await inOrg(org, svc =>
				svc.createWithContacts({
					company: { name: slug, slug, attributes: { [SITES]: 9 } },
					contacts: [],
				}),
			)
			// THEN the company is found, not created, and keeps its own value
			expect(again.created).toBe(false)
			expect((await readRow(existing.company.id)).attributes).toEqual({
				[SITES]: { value: 1, set_by: 'client' },
			})
		})
	})

	describe('when a batch carries one bad item', () => {
		it('should write no company at all', async () => {
			// GIVEN a good first item and a second with an undeclared key
			const outcome = await attempt(org, svc =>
				svc.createMany([
					{
						company: {
							name: `b1-${suffix}`,
							slug: `b1-${suffix}`,
							attributes: { [SITES]: 1 },
						},
						contacts: [],
					},
					{
						company: {
							name: `b2-${suffix}`,
							slug: `b2-${suffix}`,
							attributes: { nobody_declared: 1 },
						},
						contacts: [],
					},
				]),
			)

			// THEN the batch is refused and the first company does not exist
			expect(refusal(outcome)).toMatchObject({
				reason: 'undeclared_key',
				key: 'nobody_declared',
			})
			const r = await pool.query(
				`SELECT 1 FROM companies WHERE organization_id = $1 AND slug = $2`,
				[ORG, `b1-${suffix}`],
			)
			expect(r.rowCount).toBe(0)
		})
	})
})

describe('narrowing a list by an attribute', () => {
	let numeric: string
	let dirtyNumber: string
	let dated: string
	let dirtyDate: string
	let hubspot: string
	let zoho: string
	let percent: string
	let franchise: string
	let strong: string

	beforeAll(async () => {
		numeric = await seedCompany(ORG, {
			[SITES]: { value: 4, set_by: 'client' },
		})
		dirtyNumber = await seedCompany(ORG, {
			[SITES]: { value: 'many', set_by: 'client' },
		})
		dated = await seedCompany(ORG, {
			[FOUNDED]: { value: '2024-05-01', set_by: 'client' },
		})
		dirtyDate = await seedCompany(ORG, {
			[FOUNDED]: { value: 'soon', set_by: 'client' },
		})
		hubspot = await seedCompany(ORG, {
			[CRM]: { value: 'Hubspot', set_by: 'client' },
		})
		zoho = await seedCompany(
			ORG,
			{ [CRM]: { value: 'zoho', set_by: 'client' } },
			null,
			'FR',
		)
		percent = await seedCompany(ORG, {
			[CRM]: { value: 'up to 50% capacity', set_by: 'client' },
		})
		franchise = await seedCompany(ORG, {
			[FRANCHISE]: { value: true, set_by: 'client' },
		})
		strong = await seedCompany(ORG, {
			[FIT]: { value: 'strong', set_by: 'client' },
		})
		// The other organisation holds the same key as text; it must never show
		await seedCompany(OTHER_ORG, { [SITES]: { value: '4', set_by: 'client' } })
	})

	const search = (filters: CompanyFilters) =>
		inOrg(org, svc => svc.search({ ...filters, limit: 200 }))

	describe('when the three parts are not all given', () => {
		it('should refuse the list as incomplete', async () => {
			// GIVEN a key and an operator with no value
			const outcome = await attempt(org, svc =>
				svc.search({ attributeKey: SITES, attributeOp: 'gte' }),
			)
			// THEN it is refused rather than ignored
			expect(refusal(outcome)).toMatchObject({
				reason: 'filter_incomplete',
				key: SITES,
			})
		})
	})

	describe('when the operator does not fit the kind', () => {
		it('should refuse with the reason', async () => {
			// GIVEN a range on a yes/no key
			const outcome = await attempt(org, svc =>
				svc.search({
					attributeKey: FRANCHISE,
					attributeOp: 'gte',
					attributeValue: '1',
				}),
			)
			expect(refusal(outcome)).toMatchObject({
				reason: 'operator_not_for_kind',
				key: FRANCHISE,
			})
		})
	})

	describe('when the key is not declared', () => {
		it('should find nothing rather than fail', async () => {
			// GIVEN a filter on a key nobody declares here
			const found = await search({
				attributeKey: 'nobody_declared',
				attributeOp: 'eq',
				attributeValue: 'x',
			})
			// THEN the list is empty
			expect(found.items).toEqual([])
		})
	})

	describe('when a number key is compared', () => {
		it('should compare only rows whose value is a number', async () => {
			// GIVEN a numeric row and one whose value got in as text
			// WHEN filtered at least 3
			const found = idsIn(
				await search({
					attributeKey: SITES,
					attributeOp: 'gte',
					attributeValue: '3',
				}),
			)
			// THEN the numeric row matches and the text row neither matches nor fails the list
			expect(found).toContain(numeric)
			expect(found).not.toContain(dirtyNumber)
		})
	})

	describe('when a date key is compared', () => {
		it('should compare only rows whose value has the day shape', async () => {
			// GIVEN a dated row and one holding a word
			const found = idsIn(
				await search({
					attributeKey: FOUNDED,
					attributeOp: 'gte',
					attributeValue: '2024-01-01',
				}),
			)
			expect(found).toContain(dated)
			expect(found).not.toContain(dirtyDate)
		})
	})

	describe('when a text key is searched', () => {
		it('should match any of a list, treat a percent sign as a character, and compare eq exactly', async () => {
			// GIVEN three text rows
			const list = idsIn(
				await search({
					attributeKey: CRM,
					attributeOp: 'in',
					attributeValue: 'Hubspot, zoho',
				}),
			)
			expect(list).toContain(hubspot)
			expect(list).toContain(zoho)
			expect(list).not.toContain(percent)
			const contains = idsIn(
				await search({
					attributeKey: CRM,
					attributeOp: 'contains',
					attributeValue: '50%',
				}),
			)
			expect(contains).toEqual([percent])
			const exact = idsIn(
				await search({
					attributeKey: CRM,
					attributeOp: 'eq',
					attributeValue: 'hubspot',
				}),
			)
			expect(exact).not.toContain(hubspot)
		})
	})

	describe('when a yes/no or a choice key is compared', () => {
		it('should read the value the way the kind does', async () => {
			// GIVEN a yes written as "yes" and a choice in capitals
			const yes = idsIn(
				await search({
					attributeKey: FRANCHISE,
					attributeOp: 'eq',
					attributeValue: 'yes',
				}),
			)
			expect(yes).toContain(franchise)
			expect(yes).not.toContain(numeric)
			expect(
				idsIn(
					await search({
						attributeKey: FIT,
						attributeOp: 'eq',
						attributeValue: 'STRONG',
					}),
				),
			).toEqual([strong])
		})
	})

	describe('when a value is zero or no', () => {
		it('should store it, read it back and find it by an exact comparison', async () => {
			// GIVEN a row given a count of zero and a no
			const id = await seedCompany(ORG)
			await inOrg(org, svc =>
				svc.update(id, { attributes: { [SITES]: 0, [FRANCHISE]: false } }),
			)

			// THEN both sit on the row as themselves, and each exact filter finds the row
			expect((await readRow(id)).attributes).toEqual({
				[SITES]: { value: 0, set_by: 'client' },
				[FRANCHISE]: { value: false, set_by: 'client' },
			})
			expect(
				idsIn(
					await search({
						attributeKey: SITES,
						attributeOp: 'eq',
						attributeValue: '0',
					}),
				),
			).toContain(id)
			expect(
				idsIn(
					await search({
						attributeKey: FRANCHISE,
						attributeOp: 'eq',
						attributeValue: 'false',
					}),
				),
			).toContain(id)
		})
	})

	describe('when the attribute filter runs beside the counts', () => {
		it('should narrow every count but not what is on offer', async () => {
			// GIVEN Spanish rows with the value and a French one without
			const facets = await inOrg(org, svc =>
				svc.facets({
					attributeKey: SITES,
					attributeOp: 'gte',
					attributeValue: '3',
				}),
			)
			// THEN both countries are offered, Spain counts its matches and France none
			const byCode = new Map(facets.country.map(c => [c.value, c.count]))
			const spanishMatches = idsIn(
				await search({
					country: ['ES'],
					attributeKey: SITES,
					attributeOp: 'gte',
					attributeValue: '3',
				}),
			).length
			expect(spanishMatches).toBeGreaterThan(0)
			expect(byCode.get('ES')).toBe(spanishMatches)
			expect(byCode.get('FR')).toBe(0)
		})
	})
})

describe("one organisation's active declarations", () => {
	describe('when read over a connection that sees every tenant', () => {
		it("should still answer with this organisation's alone", async () => {
			// GIVEN the same key declared by two organisations with different kinds
			// WHEN read outside any organisation scope, as a service connection would
			const rows = await runtime.runPromise(listActiveAttributes(ORG))

			// THEN only this organisation's rows come back, this organisation's shape
			const counted = await pool.query<{ n: string }>(
				`SELECT count(*)::text AS n FROM research_attributes WHERE organization_id = $1 AND is_active`,
				[ORG],
			)
			expect(rows).toHaveLength(Number(counted.rows[0]?.n))
			expect(rows.every(row => row.organizationId === ORG)).toBe(true)
			expect(rows.find(row => row.key === SITES)?.kind).toBe('number')
		})
	})
})
