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
	MapProvider,
	makeCachedLanguageModel,
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
const stubResponseBase = {
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

// What the agent tier reports having used. The zero-token response above is
// enough for the beat itself, but a run only has spend to show if a call that
// reached a provider was priced — so the tier under test reports real tokens.
const PRICED_TOKENS_IN = 4000
const PRICED_TOKENS_OUT = 1000
// Deliberately steep: cost is stored in whole cents and rounded, so a realistic
// per-thousand rate would price a single call below half a cent and land as
// zero, which would make the assertion below pass without proving anything.
const PRICED_RATE = { inCentsPer1k: 1, outCentsPer1k: 2 } as const
// 4000/1000*1 + 1000/1000*2 = 6 cents from one call.
const PRICED_CALL_CENTS = 6

const pricedResponse = {
	...stubResponseBase,
	usage: {
		inputTokens: {
			uncached: undefined,
			total: PRICED_TOKENS_IN,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: {
			total: PRICED_TOKENS_OUT,
			text: undefined,
			reasoning: undefined,
		},
	},
}

const stubLlm: LanguageModel.Service = {
	generateText: (_options: unknown) =>
		Effect.succeed(stubResponseBase) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({
			...stubResponseBase,
			value: { summary: STUB_TEXT },
		}) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: STUB_TEXT }) as never,
}

// The agent tier answers at once and reports real tokens, so the run has
// something it has genuinely spent; the extract tier that follows it stalls, so
// the run is still running when the assertions read the row.
//
// The order matters. A call is only priced once it returns, so a tier that slept
// through the whole window left the meter empty; and a run whose every tier
// answered at once was already finished by the time it was read. Spending first
// and stalling second is the only arrangement that gives both.
const agentLlm: LanguageModel.Service = {
	...stubLlm,
	generateText: (_options: unknown) => Effect.succeed(pricedResponse) as never,
}

const extractLlm: LanguageModel.Service = {
	...stubLlm,
	generateObject: (_options: unknown) =>
		Effect.sleep('10 seconds').pipe(
			Effect.as({ ...stubResponseBase, value: { summary: STUB_TEXT } }),
		) as never,
}

const unused = 'research provider not exercised by the heartbeat suite'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
	),
)

// The agent tier goes through the same wrapper the real one does, because that
// wrapper — not the model — is what prices a call and tells the run's meter what
// it spent. Handing the service a bare stub bypasses it, and the meter then
// reports nothing however many tokens the stub claims.
const llmLayer = Layer.mergeAll(
	Layer.effect(
		AgentLanguageModel,
		makeCachedLanguageModel(
			agentLlm,
			'agent',
			'heartbeat-test-model',
			'heartbeat-test-model',
			PRICED_RATE,
			'heartbeat-test-vendor',
		),
	),
	Layer.succeed(ExtractLanguageModel)(extractLlm),
	Layer.succeed(WriterLanguageModel)(stubLlm),
)

const eventSinkLayer = Layer.succeed(ResearchEventSink)(
	ResearchEventSink.of({ fire: () => Effect.void }),
)

const ResearchLive = ResearchService.layer.pipe(
	Layer.provide(Layer.provide(llmLayer, PgLive)),
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
	// Whether the run reports it is still alive has nothing to do with the shape
	// of its answer; a brief is the cheapest one to get there.
	schemaName: 'freeform',
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
		it('should advance heartbeat_at and publish the log so far', async () => {
			// GIVEN a run whose Agent tier sleeps for several seconds, so it stays
			//   'running' while the background heartbeat loop ticks (~1s interval)
			// WHEN we let it run past a couple of intervals and read the run row
			// THEN heartbeat_at has advanced well past started_at (the claim time),
			//   proving the beat keeps a live long run fresh so the sweep spares it,
			//   and the row already carries what the run has done — the round it is
			//   sitting in opened before the model call it is waiting on
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
						toolLog: ReadonlyArray<{ tool?: string }>
						costCents: number
					}>`
						SELECT
							EXTRACT(EPOCH FROM (heartbeat_at - started_at))::float8 AS gap_seconds,
							status,
							tool_log,
							cost_cents
						FROM research_runs WHERE id = ${created.id}::uuid
					`.pipe(Effect.orDie)

					// Still running (the Agent tier is mid-sleep), and the beat has
					// advanced well past the claim — a bump fired, not just the stamp.
					return {
						status: row?.status ?? 'missing',
						gap: row?.gapSeconds ?? -1,
						logged: row?.toolLog?.length ?? -1,
						cost: row?.costCents ?? -1,
					}
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					{
						status: string
						gap: number
						logged: number
						cost: number
					},
					never,
					never
				>,
			)

			expect(outcome.status).toBe('running')
			expect(outcome.gap).toBeGreaterThan(0.5)
			// Read before the run reaches any terminal state, so this can only have
			// come from a beat: nothing else writes the column mid-run.
			expect(outcome.logged).toBeGreaterThan(0)
			// And what it has spent is on the row while it is still spending it.
			// Every other writer of this column runs at a terminal status, so a
			// figure here on a running run can only have come from the beat. Left
			// unstamped, a paid run reported costing nothing right up to the moment
			// it stopped — the one figure worth watching while it can still be
			// called off.
			expect(outcome.cost).toBeGreaterThanOrEqual(PRICED_CALL_CENTS)
		}, 30_000)
	})
})
