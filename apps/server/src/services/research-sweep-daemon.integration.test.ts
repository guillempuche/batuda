// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
// Run the periodic sweep every second and treat a beat older than a second as
// dead, so the daemon reclaims a planted orphan within the test window.
process.env['RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC'] ??= '1'
process.env['RESEARCH_ORPHAN_STALE_SEC'] ??= '1'

import { Effect, Layer, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ExtractLanguageModel,
	ExtractProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	researchToolkitLayer,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'

// Proves the *daemon* — not just the sweep function — reclaims dead runs on its
// own schedule. Building the service starts the layer-scoped periodic sweep; a
// planted orphan (stale heartbeat, but never claimed by a live fiber) must be
// flipped to 'failed' without anyone calling sweepOrphans by hand.
//
// No job runs, so the LLM + provider ports are never exercised.

interface Org {
	id: string
	name: string
	slug: string
}

const stubLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.die('llm not exercised') as never,
	generateObject: (_options: unknown) =>
		Effect.die('llm not exercised') as never,
	streamText: (_options: unknown) => Stream.die('llm not exercised') as never,
}

const unused = 'research provider not exercised by the sweep-daemon suite'
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
	Layer.provide(researchToolkitLayer.pipe(Layer.provide(providersLayer))),
	Layer.provide(eventSinkLayer),
	Layer.provideMerge(PgLive),
)

const ctx = {} as { org: Org }
let userId = ''
let orphanId: string | null = null

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
			if (orphanId) {
				yield* sql`DELETE FROM research_runs WHERE id = ${orphanId}::uuid`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService periodic sweep daemon', () => {
	describe('when a running run has no live worker', () => {
		it('should reclaim it to failed on its own schedule, without a manual sweep', async () => {
			// GIVEN the service is running (its periodic sweep daemon is live) and a
			//   running row exists whose heartbeat is already stale
			// WHEN we just wait — nobody calls sweepOrphans
			// THEN the daemon flips the orphan to 'failed' within a few ticks
			const finalStatus = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient

					const [planted] = yield* sql<{ id: string }>`
						INSERT INTO research_runs (organization_id, query, status, created_by, started_at, heartbeat_at)
						VALUES (${ctx.org.id}, 'sweep-daemon orphan', 'running', ${userId}, now() - interval '10 minutes', now() - interval '10 seconds')
						RETURNING id
					`
					orphanId = planted?.id ?? null

					// Poll until the daemon reclaims it. 40 × 300ms ≈ 12s bounds the wait
					// (interval is 1s) so a broken daemon fails fast rather than hanging.
					const poll = (
						attemptsLeft: number,
					): Effect.Effect<string, never, never> =>
						Effect.gen(function* () {
							const [row] = yield* sql<{ status: string }>`
								SELECT status FROM research_runs WHERE id = ${planted?.id}::uuid
							`.pipe(Effect.orDie)
							const status = row?.status ?? 'missing'
							if (status !== 'running' || attemptsLeft <= 0) return status
							yield* Effect.sleep('300 millis')
							return yield* poll(attemptsLeft - 1)
						})

					return yield* poll(40)
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					string,
					never,
					never
				>,
			)

			expect(finalStatus).toBe('failed')
		}, 30_000)
	})
})
