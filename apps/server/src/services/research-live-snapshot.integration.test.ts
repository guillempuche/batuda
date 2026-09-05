// The service reads these through Config when its layer is built, so they have
// to be set before the import below pulls it in. Values are irrelevant here —
// this suite only reads rows — but the layer refuses to build without them.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'
// No run is started here, so keep the background sweep and beat out of the way.
process.env['RESEARCH_HEARTBEAT_INTERVAL_SEC'] ??= '3600'
process.env['RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC'] ??= '3600'

import { Effect, Layer } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	ExtractLanguageModel,
	MapProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// Every collaborator dies if it is reached. Reading where a run is should touch
// the database and nothing else, so a stub that is called at all is the failure
// this suite wants to hear about.
const unreached = 'live snapshot must not reach a provider or a model'
const dyingLlm: LanguageModel.Service = {
	generateText: () => Effect.die(unreached) as never,
	generateObject: () => Effect.die(unreached) as never,
	streamText: () => Effect.die(unreached) as never,
}

const ResearchTestLive = ResearchService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(AgentLanguageModel)(dyingLlm),
			Layer.succeed(ExtractLanguageModel)(dyingLlm),
			Layer.succeed(WriterLanguageModel)(dyingLlm),
			Layer.succeed(SearchProvider)(
				SearchProvider.of({ search: () => Effect.die(unreached) }),
			),
			Layer.succeed(MapProvider)(
				MapProvider.of({ map: () => Effect.die(unreached) }),
			),
			Layer.succeed(ScrapeProvider)(
				ScrapeProvider.of({ scrape: () => Effect.die(unreached) }),
			),
			Layer.succeed(RegistryRouter)(
				RegistryRouter.of({ lookup: () => Effect.die(unreached) }),
			),
			Layer.succeed(ContactDiscovery)({
				discover: () => Effect.die(unreached),
			}),
			Layer.succeed(ResearchEventSink)(
				ResearchEventSink.of({ fire: () => Effect.void }),
			),
		),
	),
	Layer.provideMerge(PgLive),
)

/**
 * The one query behind every figure a watching page shows.
 *
 * It is worth its own suite because its rules live in SQL, where no type
 * catches them: whether a run has written anything down yet, which list holds
 * what it found, and which proposed changes are still waiting. A page reads
 * this every few seconds for the length of a run, so a wrong answer here is a
 * wrong answer everywhere.
 */

type Seeded = { readonly id: string }

// Every row this suite writes carries the same query text, so the clean-up
// needs no bookkeeping and removes exactly what the suite added.
const SUITE_QUERY = 'live snapshot suite'

// The organisation the rows belong to, and one they do not. Both are read as
// whole rows because entering an organisation's scope needs its name and slug,
// not just its id.
type OrgRow = {
	readonly id: string
	readonly name: string
	readonly slug: string
}

let org: OrgRow
let otherOrg: OrgRow
let userId: string

const seedRun = (fields: {
	readonly status: string
	readonly phase: number
	readonly schemaName: string | null
	readonly findings: string
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const [row] = yield* sql<Seeded>`
			INSERT INTO research_runs (
				organization_id, created_by, query, status, kind, mode,
				schema_name, phase, budget_cents, findings
			) VALUES (
				${org.id}, ${userId}, ${SUITE_QUERY}, ${fields.status}, 'leaf', 'deep',
				${fields.schemaName}, ${fields.phase}, 100, ${fields.findings}::jsonb
			) RETURNING id
		`
		if (!row) throw new Error('seed failed')
		return row.id
	})

beforeAll(async () => {
	const seed = await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const [o] = yield* sql<OrgRow>`
				SELECT id, name, slug FROM "organization" WHERE slug = 'taller' LIMIT 1
			`
			const [other] = yield* sql<OrgRow>`
				SELECT id, name, slug FROM "organization" WHERE slug = 'restaurant' LIMIT 1
			`
			const [u] = yield* sql<{ id: string }>`
				SELECT id FROM "user" WHERE email = 'admin@taller.cat' LIMIT 1
			`
			if (!o || !other || !u) {
				throw new Error(
					"taller / restaurant orgs or admin@taller.cat missing — run 'pnpm cli db reset && pnpm cli seed' first",
				)
			}
			return { org: o, otherOrg: other, userId: u.id }
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			{ org: OrgRow; otherOrg: OrgRow; userId: string },
			never,
			never
		>,
	)
	org = seed.org
	otherOrg = seed.otherOrg
	userId = seed.userId
}, 60_000)

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM research_runs WHERE query = ${SUITE_QUERY}`
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService liveSnapshot', () => {
	describe('when a run has been asked for but not started', () => {
		it('should report no phase rather than the first one', async () => {
			// GIVEN a queued run: nothing has touched it, so it has finished no
			// phases and its column still reads zero
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const id = yield* seedRun({
						status: 'queued',
						phase: 0,
						schemaName: 'prospect_scan_v1',
						findings: '{}',
					})
					return yield* svc.liveSnapshot(id, 'prospects')
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{ readonly status: string; readonly phase: number } | null,
					never,
					never
				>,
			)

			// THEN the row says it is waiting, with no phase finished — and reading
			// that as "on the first one" would have the page announce it was
			// gathering evidence before the engine had picked it up
			expect(outcome?.status).toBe('queued')
			expect(outcome?.phase).toBe(0)
		}, 30_000)
	})

	describe('when a run has written nothing down yet', () => {
		it('should say so rather than counting none', async () => {
			// GIVEN a running scan whose findings are still empty
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const id = yield* seedRun({
						status: 'running',
						phase: 1,
						schemaName: 'prospect_scan_v1',
						findings: '{}',
					})
					return yield* svc.liveSnapshot(id, 'prospects')
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{ readonly hasFindings: boolean } | null,
					never,
					never
				>,
			)

			// THEN it reports having written nothing, which the frame turns into an
			// absent count — zero would claim it looked and found none
			expect(outcome?.hasFindings).toBe(false)
		}, 30_000)
	})

	describe('when a scan has found companies and proposed changes', () => {
		it('should count the rows and only the changes still waiting', async () => {
			// GIVEN a scan holding three companies and three proposals, one of them
			// already decided
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const id = yield* seedRun({
						status: 'running',
						phase: 2,
						schemaName: 'prospect_scan_v1',
						findings: JSON.stringify({
							prospects: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
							proposed_updates: [
								{ status: 'pending' },
								{ status: 'pending' },
								{ status: 'applied' },
							],
						}),
					})
					return yield* svc.liveSnapshot(id, 'prospects')
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{
						readonly hasFindings: boolean
						readonly foundCount: number | null
						readonly pendingProposalCount: number
					} | null,
					never,
					never
				>,
			)

			// THEN every company is counted, and the decided proposal is not
			expect(outcome?.hasFindings).toBe(true)
			expect(outcome?.foundCount).toBe(3)
			expect(outcome?.pendingProposalCount).toBe(2)
		}, 30_000)
	})

	describe('when the run goes looking for no list of its own', () => {
		it('should give no count rather than zero', async () => {
			// GIVEN a brief, which is prose — there is no list of companies in it
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const id = yield* seedRun({
						status: 'running',
						phase: 1,
						schemaName: 'freeform',
						findings: JSON.stringify({ summary: 'prose' }),
					})
					return yield* svc.liveSnapshot(id, null)
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{ readonly foundCount: number | null } | null,
					never,
					never
				>,
			)

			// THEN there is nothing to count, which is not the same as none found
			expect(outcome?.foundCount).toBeNull()
		}, 30_000)
	})

	describe('when the run is gone', () => {
		it('should answer with nothing at all', async () => {
			// GIVEN a run that has been deleted, and an id belonging to no run
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const id = yield* seedRun({
						status: 'deleted',
						phase: 3,
						schemaName: 'prospect_scan_v1',
						findings: '{}',
					})
					const deleted = yield* svc.liveSnapshot(id, 'prospects')
					const missing = yield* svc.liveSnapshot(
						'00000000-0000-4000-8000-000000000000',
						'prospects',
					)
					// A caller may pass anything; a non-uuid must not reach the database
					// as a cast error, which surfaces as a 500 rather than a 404.
					const nonsense = yield* svc.liveSnapshot('not-a-uuid', 'prospects')
					return { deleted, missing, nonsense }
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{
						readonly deleted: unknown
						readonly missing: unknown
						readonly nonsense: unknown
					},
					never,
					never
				>,
			)

			// THEN each reads back as nothing, which is what ends a watcher's stream
			expect(outcome.deleted).toBeNull()
			expect(outcome.missing).toBeNull()
			expect(outcome.nonsense).toBeNull()
		}, 30_000)
	})
})

describe('ResearchService liveSnapshot under an organisation scope', () => {
	describe('when the organisation watching is not the one that owns the run', () => {
		it('should answer with nothing', async () => {
			// GIVEN a run belonging to one organisation, read once under that
			// organisation and once under another
			//
			// Entering a scope is what makes this test mean anything: the query
			// carries no organisation of its own and leans entirely on the database
			// to withhold rows (row-level security). The suite's own connection is a
			// superuser and sails past that, so a plain read here would pass even
			// with the isolation broken. `enterOrgScope` drops to the ordinary
			// application role, where the rules actually apply.
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const svc = yield* ResearchService
					const id = yield* seedRun({
						status: 'running',
						phase: 1,
						schemaName: 'prospect_scan_v1',
						findings: JSON.stringify({ prospects: [{ name: 'A' }] }),
					})
					const asOwner = yield* enterOrgScope(sql, { org, userId })(
						svc.liveSnapshot(id, 'prospects'),
					)
					const asStranger = yield* enterOrgScope(sql, {
						org: otherOrg,
						userId,
					})(svc.liveSnapshot(id, 'prospects'))
					return { asOwner, asStranger }
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{
						readonly asOwner: { readonly foundCount: number | null } | null
						readonly asStranger: unknown
					},
					never,
					never
				>,
			)

			// THEN the organisation that owns the run sees it
			expect(outcome.asOwner?.foundCount).toBe(1)
			// AND the other is told nothing at all — not a redacted row, not an
			// empty one: the same answer a run that does not exist would give
			expect(outcome.asStranger).toBeNull()
		}, 30_000)
	})
})

describe('ResearchService runSchemaName', () => {
	describe('when the run exists', () => {
		it('should give back the schema it was started with', async () => {
			// GIVEN a scan, and a brief that was stored without one
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const scan = yield* seedRun({
						status: 'running',
						phase: 1,
						schemaName: 'prospect_scan_v1',
						findings: '{}',
					})
					const unschemad = yield* seedRun({
						status: 'running',
						phase: 1,
						schemaName: null,
						findings: '{}',
					})
					return {
						scan: yield* svc.runSchemaName(scan),
						unschemad: yield* svc.runSchemaName(unschemad),
					}
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{
						readonly scan: string | null | undefined
						readonly unschemad: string | null | undefined
					},
					never,
					never
				>,
			)

			// THEN the scan names its schema, and the one stored without a schema
			// answers null — which is a run that exists, not a run that is missing
			expect(outcome.scan).toBe('prospect_scan_v1')
			expect(outcome.unschemad).toBeNull()
		}, 30_000)
	})

	describe('when there is no such run to read', () => {
		it('should answer with nothing, told apart from a run without a schema', async () => {
			// GIVEN a deleted run, an id belonging to none, and a string that is not
			// an id at all
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const deleted = yield* seedRun({
						status: 'deleted',
						phase: 3,
						schemaName: 'prospect_scan_v1',
						findings: '{}',
					})
					return {
						deleted: yield* svc.runSchemaName(deleted),
						missing: yield* svc.runSchemaName(
							'00000000-0000-4000-8000-000000000000',
						),
						nonsense: yield* svc.runSchemaName('not-a-uuid'),
					}
				}).pipe(Effect.provide(ResearchTestLive)) as Effect.Effect<
					{
						readonly deleted: string | null | undefined
						readonly missing: string | null | undefined
						readonly nonsense: string | null | undefined
					},
					never,
					never
				>,
			)

			// THEN each is undefined rather than null. The route turns exactly that
			// difference into a 404, so a looser check would start refusing every
			// run that simply has no schema.
			expect(outcome.deleted).toBeUndefined()
			expect(outcome.missing).toBeUndefined()
			expect(outcome.nonsense).toBeUndefined()
		}, 30_000)
	})
})
