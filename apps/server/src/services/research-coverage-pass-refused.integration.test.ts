// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '4'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'

import { createHash, randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	ExtractLanguageModel,
	MapProvider,
	ProviderError,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client'

// A request naming several trades goes back out for the ones nothing answered.
// When the provider refuses one of those covering passes, the run keeps what the
// earlier passes found and records why it stopped covering — rather than ending
// as an internal error and discarding the lot.
//
// The sibling suite covers a refused *refine* pass; this one covers the covering
// loop, which only runs when the request names more than one kind of company.

const SEED_URL = 'https://directory.test/trades'
const SEED_URL_HASH = createHash('sha256').update(SEED_URL).digest('hex')

const usage = {
	inputTokens: {
		uncached: undefined,
		total: 0,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 0, text: undefined, reasoning: undefined },
}

// The first pass gathers the seeded page and the refine pass does too; every
// covering pass after them is refused the way a run's own provider refuses one
// once its retries are spent.
const PASSES_BEFORE_COVERING = 2
let agentCalls = 0
const agentLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.suspend(() => {
			agentCalls += 1
			return agentCalls > PASSES_BEFORE_COVERING
				? Effect.fail(
						new ProviderError({
							provider: 'groq',
							message: 'provider refused the covering pass',
							recoverable: true,
						}),
					)
				: Effect.succeed({
						text: '',
						content: [],
						reasoning: [],
						reasoningText: undefined,
						toolCalls: [],
						toolResults: [
							{
								name: 'web_search',
								isFailure: false,
								encodedResult: undefined,
								result: {
									items: [
										{
											url: SEED_URL,
											content:
												'A directory of metalworking and plastics firms.',
										},
									],
								},
							},
						],
						finishReason: 'stop' as const,
						usage,
					})
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// The splitter runs first and is what gives the run more than one trade to
// cover; every extraction after it comes back empty, which is thin enough to
// leave both trades unanswered and send the run into the covering loop.
let extractCalls = 0
const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	generateObject: () =>
		Effect.suspend(() => {
			extractCalls += 1
			return Effect.succeed(
				extractCalls === 1
					? {
							usage,
							value: {
								parts: [
									{ label: 'calderería', terms: ['calderería'] },
									{ label: 'inyección de plástico', terms: ['inyección'] },
								],
								kindsOfCompany: [],
							},
						}
					: { usage, value: { prospects: [] } },
			)
		}) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.succeed({
			text: 'No prospects found.',
			content: [],
			usage,
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const die = 'provider not exercised'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(die) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(die) }),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(die) })),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(die) }),
	),
)

const firedEvents: string[] = []
const eventSink = Layer.succeed(ResearchEventSink)(
	ResearchEventSink.of({
		fire: (event: string) =>
			Effect.sync(() => {
				firedEvents.push(event)
			}),
	}),
)

const ResearchLive = ResearchService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(AgentLanguageModel)(agentLlm),
			Layer.succeed(ExtractLanguageModel)(extractLlm),
			Layer.succeed(WriterLanguageModel)(writerLlm),
		),
	),
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
	Layer.provide(eventSink),
	Layer.provideMerge(PgLive),
)

const runtime = ManagedRuntime.make(ResearchLive)
const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `cover-org-${randomUUID()}`
const USER = `cover-user-${randomUUID()}`
const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

const systemDefaults = {
	budgetCents: 1000,
	paidBudgetCents: 500,
	autoApprovePaidCents: 500,
	paidMonthlyCapCents: 2000,
	hardCeiling: 100_000,
}

let pool: pg.Pool

const create = (query: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			return yield* svc.create(
				USER,
				ORG,
				{ query, schemaName: 'prospect_scan_v1', forceFresh: true },
				systemDefaults,
			)
		}),
	)

const runRow = (id: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			return (yield* svc.get(id).pipe(Effect.orDie)) as {
				status?: string
				reason_code?: string | null
				findings?: {
					quality?: { coverage?: { stopped_because?: string } }
				} | null
			} | null
		}),
	)

const pollRun = async (id: string): Promise<string> => {
	for (let left = 80; left > 0; left--) {
		const status = (await runRow(id))?.status ?? 'unknown'
		if (TERMINAL.has(status)) return status
		await new Promise(resolve => setTimeout(resolve, 250))
	}
	return 'timeout'
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'stub', $2, $3, 'directory.test', 'seed')
		 ON CONFLICT (url_hash) DO NOTHING`,
		[`src-${randomUUID()}`, SEED_URL, SEED_URL_HASH],
	)
})

afterAll(async () => {
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM sources WHERE url_hash = $1`, [SEED_URL_HASH])
	await runtime.dispose()
	await pool.end()
})

describe('a refused covering pass', () => {
	describe('when the provider refuses a pass sent for an unanswered trade', () => {
		it('should stop covering and say so, instead of failing the run', async () => {
			// GIVEN a request naming two trades, whose covering pass is refused
			const created = await create(
				'Empresas de CALDERERÍA e INYECCIÓN DE PLÁSTICO con taller propio en Terrassa',
			)
			const id = (created as { id: string }).id

			// WHEN the run completes
			const status = await pollRun(id)
			const row = await runRow(id)

			// THEN the refusal did not end the run as an internal error
			expect(status).toBe('no_reliable_data')
			expect(row?.reason_code).not.toBe('internal_error')

			// AND the run records that it stopped covering because the provider
			// would not answer — not that the trades were searched and found empty
			expect(row?.findings?.quality?.coverage?.stopped_because).toBe(
				'provider_failed',
			)

			// AND it really did go back out for the uncovered trades
			expect(firedEvents).toContain('research.covering')
			expect(agentCalls).toBeGreaterThan(PASSES_BEFORE_COVERING)
		})
	})
})
