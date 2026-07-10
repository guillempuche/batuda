// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
// The service reads this concurrency gate via Config at layer-build time.
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'

import { randomUUID } from 'node:crypto'

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

// A research run is created inside the request transaction (the org middleware
// wraps every handler in sql.withTransaction) and then handed to the
// layer-scoped dispatch consumer, which runs the job on the service's OWN clean
// connection — never the request's already-committed one. This drives the real
// ResearchService end-to-end: create() inside a request scope, then the job
// runs to succeeded, including the sql.withTransaction cache write that crashed
// under bug #171 when a job wrongly inherited the committed request connection.
//
// The provider ports below are never exercised: the Agent language model stub
// returns no tool calls, so the toolkit handlers (web_search/scrape/etc.) are
// never invoked. They exist only so researchToolkitLayer builds.

interface Org {
	id: string
	name: string
	slug: string
}

// A deterministic language-model response shaped like the shipped stub — the
// fields the research fiber reads back (text, usage totals, empty toolCalls).
const STUB_TEXT =
	'Acme Corp S.L. is a Barcelona-based industrial solutions company. ' +
	'They employ 85 people and reported €12M revenue in 2025.'

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

// The three tiers share this zero-cost stub; the `as never` casts match the
// shipped stub (the real LanguageModel.Service response type is far wider than
// what the fiber reads).
const stubLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.succeed(stubResponse) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({
			...stubResponse,
			value: {
				company_name: 'Acme Corp S.L.',
				tax_id: 'B12345678',
				summary: STUB_TEXT,
			},
		}) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: STUB_TEXT }) as never,
}

// The search_cache key the Agent stub's #171-shaped write lands on. A committed
// row here after the run succeeds proves the write ran its own BEGIN/COMMIT on a
// clean connection (a distinct prefix from the sibling suite's `it-171-%` so
// neither cleanup touches the other's rows).
const searchCacheKey = `it-svc-171-${randomUUID()}`

// The Agent tier: before returning the deterministic response, perform the exact
// advisory-locked search_cache upsert web_search runs, inside its own
// transaction. Forked onto the request connection (the bug) this dies on
// "ROLLBACK TO SAVEPOINT ... in transaction blocks"; on the service's clean
// connection it commits.
const agentLlm: LanguageModel.Service = {
	...stubLlm,
	generateText: (_options: unknown) =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* Effect.gen(function* () {
				yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`search:${searchCacheKey}`}))`
				yield* sql`
					INSERT INTO search_cache (
						key_hash, provider, query, items, units_cost, cached_at, expires_at
					) VALUES (
						${searchCacheKey}, 'it-stub', 'q', '[]'::jsonb, 0, now(), now() + interval '1 hour'
					)
					ON CONFLICT (key_hash) DO UPDATE SET cached_at = now()
				`
			}).pipe(sql.withTransaction)
			return stubResponse
		}) as never,
}

// Provider ports the toolkit builds against but never calls (no tool calls are
// emitted). Dying makes any accidental invocation fail loudly rather than pass
// silently.
const unused = 'research provider not exercised by the Agent stub'
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

// A no-op event sink: the run fires observability events we don't assert on.
const eventSinkLayer = Layer.succeed(ResearchEventSink)(
	ResearchEventSink.of({ fire: () => Effect.void }),
)

// The full service under test. provideMerge(PgLive) both feeds the service its
// SqlClient AND re-exports it, so the test's request transaction and the
// service's dispatch consumer draw from the same connection pool — exactly the
// runtime wiring.
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
	query: 'F1 dispatch test',
	// Skip the outer research_cache lookup so a fresh fiber always runs.
	forceFresh: true,
}

const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

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
				// research_cache has no ON DELETE CASCADE from research_runs, so it
				// must go first; research_run_sources / research_links / paid_spend
				// cascade with the run row.
				yield* sql`DELETE FROM research_cache WHERE research_id = ${runId}::uuid`
				yield* sql`DELETE FROM research_runs WHERE id = ${runId}::uuid`
			}
			yield* sql`DELETE FROM search_cache WHERE key_hash = ${searchCacheKey}`
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService dispatch', () => {
	describe('when a run is created inside a request transaction', () => {
		it('should commit its cache write on the consumer’s clean connection', async () => {
			// GIVEN the real ResearchService with stub providers + LLMs, where the
			//   Agent tier performs the #171-shaped sql.withTransaction cache write
			// WHEN create() runs inside enterOrgScope (a real request transaction)
			//   and the layer-scoped consumer picks the queued run up and runs it
			// THEN the cache row committed — proving the job's own transaction opened
			//   on a clean connection, not the request's already-committed one. The
			//   run itself ends no_reliable_data: the Agent stub emits no tool calls,
			//   so nothing is scraped and the grounding gate fails it closed.
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const sql = yield* SqlClient.SqlClient

					// create() runs inside the request transaction, like the HTTP
					// handler under OrgMiddleware. It returns a queued run id.
					const created = yield* enterOrgScope(sql, {
						org: ctx.org,
						userId,
					})(svc.create(userId, ctx.org.id, researchInput, systemDefaults))
					runId = created.id

					// Poll get() until the dispatch consumer drives the run terminal.
					// 50 × 300ms bounds the wait so a stuck run reports its last status
					// rather than hanging the suite.
					const poll = (
						attemptsLeft: number,
					): Effect.Effect<
						{ status: string; errorMessage: string | null },
						never,
						never
					> =>
						Effect.gen(function* () {
							const run = (yield* svc.get(created.id).pipe(Effect.orDie)) as {
								status?: string
								errorMessage?: string | null
							} | null
							const status = run?.status ?? 'unknown'
							if (TERMINAL.has(status) || attemptsLeft <= 0) {
								return { status, errorMessage: run?.errorMessage ?? null }
							}
							yield* Effect.sleep('300 millis')
							return yield* poll(attemptsLeft - 1)
						})

					const final = yield* poll(50)

					const cacheRows = yield* sql<{ keyHash: string }>`
						SELECT key_hash FROM search_cache WHERE key_hash = ${searchCacheKey}
					`.pipe(Effect.orDie)

					return {
						status: final.status,
						errorMessage: final.errorMessage,
						cacheCommitted: cacheRows.length > 0,
						queuedId: created.id,
						createStatus: created.status,
					}
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					{
						status: string
						errorMessage: string | null
						cacheCommitted: boolean
						queuedId: string
						createStatus: string
					},
					never,
					never
				>,
			)

			expect(outcome.createStatus).toBe('queued')
			expect(outcome.queuedId).toBeTruthy()
			// The stub scrapes nothing, so the run fails closed to no_reliable_data;
			// what matters here is that its search_cache write committed on a clean
			// connection — which happens in phase 1 regardless of the final verdict.
			expect(
				outcome.status,
				`run not terminal: ${outcome.errorMessage ?? '(no error recorded)'}`,
			).toBe('no_reliable_data')
			expect(outcome.cacheCommitted).toBe(true)
		}, 30_000)
	})
})
