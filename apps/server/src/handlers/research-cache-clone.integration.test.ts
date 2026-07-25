// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cloneCacheHitRun } from '@batuda/research'

import { PgLive } from '../db/client.js'

// Regression coverage for #276: reusing an identical research query as a
// `cache_hit` clone must keep `findings` byte-identical to the source run.
// `cloneCacheHitRun` copies findings src → clone inside Postgres so the stored
// value never round-trips through JS and cannot be reshaped on the way. These
// run as `app_user` with `app.current_org_id` set, exactly like a request
// handler (see middleware/org.ts), so the research_runs RLS policy engages just
// as it does at runtime.
//
// Prereq: `pnpm cli services up` so Postgres is reachable; the integration
// runner builds + seeds `batuda_it`.

// organization_id / created_by are free text on research_runs (no FK), so the
// suite owns a synthetic org + user and cleans up by org id — no seed coupling.
const ORG_ID = `it-276-org-${randomUUID()}`
const USER_ID = `it-276-user-${randomUUID()}`

// The exact snake_case shape from the issue: a top-level list plus a deeply
// nested key, so the assertions cover both the outer and the nested level.
const SNAKE_FINDINGS = {
	proposed_updates: [
		{
			id: 'p-1',
			status: 'pending',
			subject_table: 'companies',
			subject_id: 'c-1',
			fields: {},
		},
	],
	enrichment: { country: { value: 'ES', source_id: 's-1' } },
}

// Enter app_user org scope for the current transaction, mirroring middleware/org.ts.
const enterOrgScope = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`SET LOCAL ROLE app_user`
	yield* sql`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`
})

// Seed a succeeded source run whose findings are byte-controlled snake_case.
const seedSourceRun = (findingsJson: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const [row] = yield* sql<{ id: string }>`
			INSERT INTO research_runs (
				organization_id, query, mode, schema_name, kind, status,
				findings, brief_md, tokens_in, tokens_out, created_by,
				started_at, completed_at
			) VALUES (
				${ORG_ID}, 'it-276 cache casing', 'deep', 'company_enrichment_v1',
				'leaf', 'succeeded',
				${findingsJson}::jsonb, 'source brief', 11, 22, ${USER_ID},
				now(), now()
			) RETURNING id
		`
		return row?.id ?? ''
	})

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`GRANT app_user TO CURRENT_USER`
		}).pipe(Effect.provide(PgLive)),
	)
})

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM research_runs WHERE organization_id = ${ORG_ID}`
		}).pipe(Effect.provide(PgLive)),
	)
})

describe('cloneCacheHitRun', () => {
	describe('when cloning a succeeded run whose findings use snake_case keys', () => {
		it('should store the clone findings jsonb-equal to the source, keys still snake_case', async () => {
			// GIVEN a succeeded source run with the issue's snake_case findings, WHEN
			// it is reused as a cache_hit clone, THEN the clone's findings equal the
			// source's and keep snake_case keys.
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* Effect.gen(function* () {
						yield* enterOrgScope
						const sourceId = yield* seedSourceRun(
							JSON.stringify(SNAKE_FINDINGS),
						)
						const cloned = yield* cloneCacheHitRun({
							sql,
							cachedId: sourceId,
							organizationId: ORG_ID,
							userId: USER_ID,
							input: {
								query: 'it-276 cache casing',
								mode: 'deep',
								schemaName: 'company_enrichment_v1',
							},
							templateIds: [],
							templateNames: [],
							templateFingerprint: '',
						})
						if (!cloned) return { clonedId: null, cmp: null }
						const [cmp] = yield* sql<{
							eq: boolean
							cloneText: string
							kind: string
						}>`
							SELECT
								(c.findings = s.findings) AS eq,
								c.findings::text AS clone_text,
								c.kind AS kind
							FROM research_runs c, research_runs s
							WHERE c.id = ${cloned.id} AND s.id = ${sourceId}
						`
						return { clonedId: cloned.id, cmp: cmp ?? null }
					}).pipe(sql.withTransaction)
				}).pipe(Effect.provide(PgLive)),
			)

			expect(result.clonedId).not.toBeNull()
			expect(result.cmp).not.toBeNull()
			const cmp = result.cmp
			if (!cmp) throw new Error('no clone row read back')

			// The clone is recorded as a cache_hit and its findings are jsonb-equal.
			expect(cmp.kind).toBe('cache_hit')
			expect(cmp.eq).toBe(true)

			// The stored keys survive the clone exactly as written.
			const findings = JSON.parse(cmp.cloneText) as Record<string, unknown>
			expect(findings).toHaveProperty('proposed_updates')
			expect(findings).not.toHaveProperty('proposedUpdates')
			const country = (
				findings['enrichment'] as { country?: Record<string, unknown> }
			).country
			expect(country).toHaveProperty('source_id')
			expect(country).not.toHaveProperty('sourceId')
		})
	})
})

// What every reader of a run's findings depends on: a plain `SELECT findings`
// hands back the keys that were stored, and a list whose first entry is empty
// reads back instead of failing the query.
describe('reading findings through the SQL client', () => {
	describe('when the stored findings use snake_case keys', () => {
		it('should hand back the stored keys unchanged', async () => {
			// GIVEN findings stored with snake_case keys
			// WHEN they are read back with a plain SELECT
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* Effect.gen(function* () {
						yield* enterOrgScope
						const id = yield* seedSourceRun(JSON.stringify(SNAKE_FINDINGS))
						const [plain] = yield* sql<{
							findings: Record<string, unknown>
						}>`SELECT findings FROM research_runs WHERE id = ${id}`
						return plain?.findings ?? null
					}).pipe(sql.withTransaction)
				}).pipe(Effect.provide(PgLive)),
			)

			// THEN the keys survive the round trip, nested ones included
			expect(result).not.toBeNull()
			expect(result).toHaveProperty('proposed_updates')
			expect(result).not.toHaveProperty('proposedUpdates')
			const country = (
				result as { enrichment: { country?: Record<string, unknown> } }
			).enrichment.country
			expect(country).toHaveProperty('source_id')
			expect(country).not.toHaveProperty('sourceId')
		})
	})

	describe('when a stored list starts with an empty entry', () => {
		it('should read the run back instead of failing', async () => {
			// GIVEN findings holding a list that starts with an empty entry — what a
			// group run stores when its first child finishes without any findings
			const findings = { leaf_results: [null, { schema_name: 'freeform_v1' }] }

			// WHEN the run is read back
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* Effect.gen(function* () {
						yield* enterOrgScope
						const id = yield* seedSourceRun(JSON.stringify(findings))
						const [row] = yield* sql<{
							findings: { leaf_results: ReadonlyArray<unknown> }
						}>`SELECT findings FROM research_runs WHERE id = ${id}`
						return row?.findings ?? null
					}).pipe(sql.withTransaction)
				}).pipe(Effect.provide(PgLive)),
			)

			// THEN the read succeeds and the list arrives intact, empty entry first
			expect(result).not.toBeNull()
			expect(result?.leaf_results).toHaveLength(2)
			expect(result?.leaf_results[0]).toBeNull()
			expect(result?.leaf_results[1]).toEqual({ schema_name: 'freeform_v1' })
		})
	})
})
