// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
// The service reads this concurrency gate via Config at layer-build time.
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
// Park the periodic sweep daemon far out so the only sweep that runs after the
// rows are inserted is the manual sweepOrphans() call under test (its first tick
// still fires at layer build, before any row exists).
process.env['RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC'] ??= '3600'

import { Effect, Layer, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	ExtractLanguageModel,
	ExtractProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'

// This suite drives the real ResearchService's orphan sweep. A running research
// job refreshes research_runs.heartbeat_at every ~30s; if its process dies, the
// beat stops. sweepOrphans() fails a running row whose heartbeat is stale — so a
// crashed run is cleaned up — while a legitimately long-running job (fresh beat)
// is spared even if its started_at is old. Rows created before heartbeats
// existed (NULL beat) fall back to the started_at age check.
//
// No job actually runs here (we call sweepOrphans directly), so the LLM + provider
// ports are never exercised; the stubs exist only so the service layer builds.

interface Org {
	id: string
	name: string
	slug: string
}

// A zero-cost language-model stub; never invoked (no job runs). The `as never`
// casts match the shipped stub — the real response type is far wider than the
// fields a run would read.
const stubLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.die('llm not exercised') as never,
	generateObject: (_options: unknown) =>
		Effect.die('llm not exercised') as never,
	streamText: (_options: unknown) => Stream.die('llm not exercised') as never,
}

// Provider ports the toolkit builds against but never calls; dying makes any
// accidental invocation fail loudly.
const unused = 'research provider not exercised by the orphan-sweep suite'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
	),
	Layer.succeed(ExtractProvider)(
		ExtractProvider.of({ extract: () => Effect.die(unused) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
	),
)

const llmLayer = Layer.mergeAll(
	Layer.succeed(AgentLanguageModel)(stubLlm),
	Layer.succeed(ExtractLanguageModel)(stubLlm),
	Layer.succeed(WriterLanguageModel)(stubLlm),
)

const eventSinkLayer = Layer.succeed(ResearchEventSink)(
	ResearchEventSink.of({ fire: () => Effect.void }),
)

const ResearchLive = ResearchService.layer.pipe(
	Layer.provide(llmLayer),
	Layer.provide(providersLayer),
	Layer.provide(
		Layer.succeed(ContactDiscovery)({
			discover: () =>
				Effect.succeed({
					status: 'no_reliable_contact' as const,
					researchId: 'test',
				}),
		}),
	),
	Layer.provide(eventSinkLayer),
	Layer.provideMerge(PgLive),
)

const ctx = {} as { org: Org }
let userId = ''
const insertedIds: string[] = []

beforeAll(async () => {
	const seed = await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const [org] = yield* sql<Org>`
				SELECT id, name, slug FROM "organization" WHERE slug = 'taller' LIMIT 1
			`
			const [user] = yield* sql<{ id: string }>`
				SELECT id FROM "user" WHERE email = 'admin@taller.cat' LIMIT 1
			`
			if (!org || !user) {
				throw new Error(
					"taller org / admin@taller.cat missing — run 'pnpm cli db reset && pnpm cli seed' first",
				)
			}
			return { org, userId: user.id }
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			{ org: Org; userId: string },
			never,
			never
		>,
	)
	ctx.org = seed.org
	userId = seed.userId
}, 60_000)

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			if (insertedIds.length > 0) {
				yield* sql`DELETE FROM research_runs WHERE id = ANY(${insertedIds}::uuid[])`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService orphan sweep', () => {
	describe('when reclaiming running runs by heartbeat staleness', () => {
		it('should fail a stale-heartbeat run, spare a fresh-heartbeat one, and fall back to age for a NULL-heartbeat row', async () => {
			// GIVEN three running runs — a stale heartbeat (5 min old), a fresh
			//   heartbeat but an old started_at (a legitimately long run), and a NULL
			//   heartbeat with an old started_at (a row predating heartbeats)
			// WHEN sweepOrphans runs with a short age threshold
			// THEN the stale + NULL rows are failed, but the fresh one stays running —
			//   proving the sweep reclaims dead runs without killing live long ones
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const sql = yield* SqlClient.SqlClient

					// heartbeat_at takes now()-relative SQL, so the rows go in inline:
					// a stale beat, a fresh beat with an old started_at (a live long
					// run), and a NULL beat with an old started_at (predates heartbeats).
					const staleId = yield* sql<{ id: string }>`
						INSERT INTO research_runs (organization_id, query, status, created_by, started_at, heartbeat_at)
						VALUES (${ctx.org.id}, 'orphan-sweep stale', 'running', ${userId}, now() - interval '10 minutes', now() - interval '5 minutes')
						RETURNING id
					`.pipe(Effect.map(rows => rows[0]?.id ?? ''))
					const freshId = yield* sql<{ id: string }>`
						INSERT INTO research_runs (organization_id, query, status, created_by, started_at, heartbeat_at)
						VALUES (${ctx.org.id}, 'orphan-sweep fresh', 'running', ${userId}, now() - interval '30 minutes', now())
						RETURNING id
					`.pipe(Effect.map(rows => rows[0]?.id ?? ''))
					const legacyId = yield* sql<{ id: string }>`
						INSERT INTO research_runs (organization_id, query, status, created_by, started_at, heartbeat_at)
						VALUES (${ctx.org.id}, 'orphan-sweep legacy', 'running', ${userId}, now() - interval '30 minutes', NULL)
						RETURNING id
					`.pipe(Effect.map(rows => rows[0]?.id ?? ''))
					insertedIds.push(staleId, freshId, legacyId)

					// Age threshold 60s only gates the NULL-heartbeat fallback; the
					// stale/fresh decision keys off RESEARCH_ORPHAN_STALE_SEC (default 90s).
					yield* svc.sweepOrphans(60).pipe(Effect.orDie)

					const rows = yield* sql<{ id: string; status: string }>`
						SELECT id, status FROM research_runs
						WHERE id = ANY(${[staleId, freshId, legacyId]}::uuid[])
					`
					const statusById = new Map(rows.map(r => [r.id, r.status]))
					return {
						stale: statusById.get(staleId),
						fresh: statusById.get(freshId),
						legacy: statusById.get(legacyId),
					}
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					{
						stale: string | undefined
						fresh: string | undefined
						legacy: string | undefined
					},
					never,
					never
				>,
			)

			expect(outcome.stale).toBe('failed')
			expect(outcome.fresh).toBe('running')
			expect(outcome.legacy).toBe('failed')
		}, 30_000)
	})
})
