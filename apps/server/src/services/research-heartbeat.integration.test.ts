// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'
// Beat once a second so a bump is observable within the test's short window.
process.env['RESEARCH_HEARTBEAT_INTERVAL_SEC'] ??= '1'
// Keep the periodic orphan sweep out of the way — this suite watches a live run.
process.env['RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC'] ??= '3600'

import { Effect, Layer, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	type CreateResearchInput,
	ExtractLanguageModel,
	ExtractProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	type SystemDefaults,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// A running research job forks a background loop that refreshes
// research_runs.heartbeat_at every RESEARCH_HEARTBEAT_INTERVAL_SEC while it
// works, and that loop is scoped to the run so it stops when the run ends. This
// suite proves the beat actually advances: the Agent tier sleeps so the run
// stays 'running' long enough for a bump to land, then we check that heartbeat_at
// has moved past started_at (the claim time). Without a live beat the orphan
// sweep would eventually mistake a long run for a dead one.

interface Org {
	id: string
	name: string
	slug: string
}

const STUB_TEXT = 'Heartbeat test — deterministic stub response.'
const stubResponse = {
	text: STUB_TEXT,
	content: [{ type: 'text' as const, text: STUB_TEXT }],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
	usage: {
		inputTokens: {
			uncached: undefined,
			total: 0,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: 0, text: undefined, reasoning: undefined },
	},
}

const stubLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.succeed(stubResponse) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({
			...stubResponse,
			value: { summary: STUB_TEXT },
		}) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: STUB_TEXT }) as never,
}

// The Agent tier holds the run in phase 1 for a few seconds, so the run stays
// 'running' across several heartbeat intervals while we observe the beat advance.
const agentLlm: LanguageModel.Service = {
	...stubLlm,
	generateText: (_options: unknown) =>
		Effect.sleep('3 seconds').pipe(Effect.as(stubResponse)) as never,
}

const unused = 'research provider not exercised by the heartbeat suite'
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
	Layer.succeed(AgentLanguageModel)(agentLlm),
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

const systemDefaults: SystemDefaults = {
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	hardCeiling: 5000,
}

const researchInput: CreateResearchInput = {
	query: 'heartbeat advance test',
	forceFresh: true,
}

const ctx = {} as { org: Org }
let userId = ''
let runId: string | null = null

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
			if (runId) {
				yield* sql`DELETE FROM research_runs WHERE id = ${runId}::uuid`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService heartbeat', () => {
	describe('when a run stays running across a heartbeat interval', () => {
		it('should advance heartbeat_at past the run’s started_at', async () => {
			// GIVEN a run whose Agent tier sleeps for several seconds, so it stays
			//   'running' while the background heartbeat loop ticks (~1s interval)
			// WHEN we let it run past a couple of intervals and read the run row
			// THEN heartbeat_at has advanced well past started_at (the claim time),
			//   proving the beat keeps a live long run fresh so the sweep spares it
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const sql = yield* SqlClient.SqlClient

					const created = yield* enterOrgScope(sql, {
						org: ctx.org,
						userId,
					})(svc.create(userId, ctx.org.id, researchInput, systemDefaults))
					// A non-selector input never fans out, so it always carries a run
					// id; rule out the confirm-required variant to keep the type honest.
					if (created.status === 'confirm_required')
						return yield* Effect.die(
							new Error('heartbeat test input should not fan out'),
						)
					runId = created.id

					// Wait until the consumer has claimed the run (status flips to
					// running), bounded so a stuck run fails fast instead of hanging.
					const waitRunning = (
						attemptsLeft: number,
					): Effect.Effect<void, never, never> =>
						Effect.gen(function* () {
							const [row] = yield* sql<{ status: string }>`
								SELECT status FROM research_runs WHERE id = ${created.id}::uuid
							`.pipe(Effect.orDie)
							if (row?.status === 'running' || attemptsLeft <= 0) return
							yield* Effect.sleep('100 millis')
							return yield* waitRunning(attemptsLeft - 1)
						})
					yield* waitRunning(50)

					// Let a couple of ~1s beats land while the Agent tier still sleeps.
					yield* Effect.sleep('2200 millis')

					// The SQL client camelCases result keys, so `gap_seconds` comes
					// back as `gapSeconds`.
					const [row] = yield* sql<{
						gapSeconds: number
						status: string
					}>`
						SELECT
							EXTRACT(EPOCH FROM (heartbeat_at - started_at))::float8 AS gap_seconds,
							status
						FROM research_runs WHERE id = ${created.id}::uuid
					`.pipe(Effect.orDie)

					// Still running (the Agent tier is mid-sleep), and the beat has
					// advanced well past the claim — a bump fired, not just the stamp.
					return {
						status: row?.status ?? 'missing',
						gap: row?.gapSeconds ?? -1,
					}
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					{ status: string; gap: number },
					never,
					never
				>,
			)

			expect(outcome.status).toBe('running')
			expect(outcome.gap).toBeGreaterThan(0.5)
		}, 30_000)
	})
})
