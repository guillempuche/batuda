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

// A scan whose first pass gathered evidence, and whose refined second pass the
// provider then refuses, must keep what the first pass found and finish on it.
// Letting the refusal out ends the whole run as an internal error and throws
// away every source and finding already paid for — the extra pass is worth
// trying, never worth the run.

const SEED_URL = 'https://directory.test/freight-brokers'
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

// Agent passes, counted: the first gathers the seeded source and stops, every
// one after it is refused by the provider the way a model's own malformed tool
// call is refused once its retries are spent.
let agentCalls = 0
const agentLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.suspend(() => {
			agentCalls += 1
			return agentCalls > 1
				? Effect.fail(
						new ProviderError({
							provider: 'groq',
							message:
								"Invalid parameters for tool 'web_search': tool call validation failed",
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
												'A directory listing of US freight brokerage firms.',
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

// Extractor: an empty list, which is thin enough to earn the refined retry the
// provider then refuses.
const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	generateObject: () =>
		Effect.succeed({ usage, value: { prospects: [] } }) as never,
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
const ORG = `refuse-org-${randomUUID()}`
const USER = `refuse-user-${randomUUID()}`
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
				findings?: { error?: string } | null
			} | null
		}),
	)

const pollRun = async (id: string): Promise<string> => {
	for (let left = 60; left > 0; left--) {
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

describe('a refused extra searching pass', () => {
	describe('when the provider refuses the refined retry', () => {
		it('should keep the first pass and finish on it instead of failing the run', async () => {
			// GIVEN a prospect scan whose first pass gathers a source, and whose
			// refined retry the provider refuses
			const created = await create(
				'Find midsize US freight brokerage prospects',
			)
			const id = (created as { id: string }).id

			// WHEN the run completes
			const status = await pollRun(id)

			// THEN the refusal did not end the run as an internal error
			// AND the run settled on what it actually knew after the first pass
			expect(status).toBe('no_reliable_data')
			const row = await runRow(id)
			expect(row?.reason_code).not.toBe('internal_error')

			// AND it does not tell the reader it refined and still found nothing —
			// the refined pass never ran, and an empty list read as a refined one
			// reads as an empty market
			expect(row?.findings?.error ?? '').not.toContain('refined retry')

			// AND it really did try to refine — the pass the provider refused
			expect(firedEvents).toContain('research.refining')
			expect(agentCalls).toBeGreaterThan(1)
		})
	})
})
