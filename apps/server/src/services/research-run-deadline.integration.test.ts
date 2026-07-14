// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'
// Keep the heartbeat beating fast so the run stays visibly alive throughout,
// proving it is the whole-run deadline — not the stale-heartbeat sweep — that
// fails the wedged run.
process.env['RESEARCH_HEARTBEAT_INTERVAL_SEC'] ??= '1'
process.env['RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC'] ??= '3600'
process.env['RESEARCH_ORPHAN_STALE_SEC'] ??= '3600'
// Short whole-run cap so a run whose phase-1 call never returns is failed within
// the test's window.
process.env['RESEARCH_RUN_DEADLINE_SEC'] ??= '2'

import { Effect, Layer, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	type CreateResearchInput,
	ExtractLanguageModel,
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

// A run's phase-1 model call has no wall-clock bound of its own here (the tier is
// injected as a raw stub, not the hardened one), so a call that never returns
// keeps the run 'running' while its heartbeat keeps beating — invisible to the
// orphan sweep. This suite proves the whole-run deadline is the backstop that
// fails such a run: the Agent tier sleeps far past RESEARCH_RUN_DEADLINE_SEC, and
// we assert the run lands 'failed' with a time-limit reason.

interface Org {
	id: string
	name: string
	slug: string
}

const STUB_TEXT = 'Deadline test — deterministic stub response.'
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

// The Agent tier wedges phase 1 for far longer than the run deadline, so the
// only thing that can end the run is the deadline itself.
const wedgedAgentLlm: LanguageModel.Service = {
	...stubLlm,
	generateText: (_options: unknown) =>
		Effect.sleep('60 seconds').pipe(Effect.as(stubResponse)) as never,
}

const unused = 'research provider not exercised by the deadline suite'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
	),
)

const llmLayer = Layer.mergeAll(
	Layer.succeed(AgentLanguageModel)(wedgedAgentLlm),
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
	query: 'run deadline test',
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

describe('ResearchService run deadline', () => {
	describe('when a running job never finishes but keeps beating', () => {
		it('should fail the run at the whole-run deadline, not leave it running', async () => {
			// GIVEN a run whose Agent tier sleeps far past RESEARCH_RUN_DEADLINE_SEC
			//   (2s), so its heartbeat keeps beating and the orphan sweep would spare
			//   it — only the whole-run deadline can end it
			// WHEN we let it run past the deadline and read the run row
			// THEN it has been marked 'failed' with an internal_error reason whose
			//   detail names the time limit — the backstop fired
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const sql = yield* SqlClient.SqlClient

					const created = yield* enterOrgScope(sql, {
						org: ctx.org,
						userId,
					})(svc.create(userId, ctx.org.id, researchInput, systemDefaults))
					runId = created.id ?? null

					// Wait until the consumer has claimed the run (status → running),
					// bounded so a stuck dispatch fails fast instead of hanging.
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

					// Let the 2s deadline elapse (plus margin) while the Agent tier is
					// still mid-sleep, then read the terminal row.
					yield* Effect.sleep('4 seconds')

					const [row] = yield* sql<{
						status: string
						reasonCode: string | null
						error: string | null
					}>`
						SELECT status, reason_code, findings->>'error' AS error
						FROM research_runs WHERE id = ${created.id}::uuid
					`.pipe(Effect.orDie)

					return {
						status: row?.status ?? 'missing',
						reasonCode: row?.reasonCode ?? 'missing',
						error: row?.error ?? '',
					}
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					{ status: string; reasonCode: string; error: string },
					never,
					never
				>,
			)

			expect(outcome.status).toBe('failed')
			expect(outcome.reasonCode).toBe('internal_error')
			expect(outcome.error).toContain('time limit')
		}, 30_000)
	})
})
