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
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client'

// A non-anchored prospect scan whose extraction keeps coming back empty should
// refine-and-retry once, then finish `no_reliable_data` instead of a green
// "succeeded" over an empty list. Both agent passes gather the one seeded
// source (so the grounding gate passes) and the extractor always returns an
// empty `prospects` list, forcing the retry and the honest terminal status.

// A canonical URL hashes to itself, so this matches what the run fiber's
// source-linking computes for the web_search result below.
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

// Agent pass: hand back one web_search result (real fetched evidence) and no
// further tool calls, so each pass gathers the seeded source then stops.
const agentLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.succeed({
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
								content: 'A directory listing of US freight brokerage firms.',
							},
						],
					},
				},
			],
			finishReason: 'stop' as const,
			usage,
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// Extractor: always empty prospects → drives the retry and the empty verdict.
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
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(die) }),
	),
)

// Record every event the run fires so the test can assert the refine step ran.
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
const ORG = `scan-org-${randomUUID()}`
const USER = `scan-user-${randomUUID()}`
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

const runStatus = (id: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const run = (yield* svc.get(id).pipe(Effect.orDie)) as {
				status?: string
			} | null
			return run?.status ?? 'unknown'
		}),
	)

const pollRun = async (id: string): Promise<string> => {
	for (let left = 60; left > 0; left--) {
		const status = await runStatus(id)
		if (TERMINAL.has(status)) return status
		await new Promise(resolve => setTimeout(resolve, 250))
	}
	return 'timeout'
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// Seed the one source both passes "fetch", so the grounding gate passes and
	// the run reaches the empty-findings verdict.
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

describe('empty discovery-scan retry', () => {
	describe('when a prospect scan extracts no prospects', () => {
		it('should refine-and-retry once, then finish no_reliable_data', async () => {
			// GIVEN a broad, non-anchored prospect scan
			const created = await create(
				'Find midsize US freight brokerage prospects',
			)
			const id = (created as { id: string }).id

			// WHEN the run completes
			const status = await pollRun(id)

			// THEN it refined once and settled on the honest terminal status,
			// not a green success over an empty list
			expect(status).toBe('no_reliable_data')
			expect(firedEvents).toContain('research.refining')
		})
	})
})
