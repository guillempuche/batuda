// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '2'
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

// The check that removes rows that are not companies of the kind asked for is
// told what the request asked for — but only on a prospect scan whose request
// the parser could read. A competitor scan asks about one named company, and a
// request the parse failed on has nothing to hand over, so both put the question
// to the model exactly as it was. This drives the three cases through the real
// service and reads the question the check actually asked.

const SEED_URL = 'https://directory.test/makers'
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
								content: 'A directory of makers of industrial buildings.',
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

// Which list the run under way answers with, and whether its request parse is
// to be refused — set per case, since one model stands in for every run.
let listField: 'prospects' | 'competitors' = 'prospects'
let refuseTheParse = false
// Every question the kind check put to the model, in order.
const kindCheckPrompts: string[] = []

// One shape for every reply the stand-in extract model gives, so the branches
// below agree on a type whatever each one puts in `value`.
type Reply = { readonly usage: typeof usage; readonly value: unknown }

const promptText = (options: unknown): string => {
	const prompt = (options as { prompt?: unknown }).prompt
	return typeof prompt === 'string' ? prompt : JSON.stringify(prompt ?? '')
}

const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	generateObject: (options: unknown) =>
		Effect.suspend((): Effect.Effect<Reply, ProviderError> => {
			const prompt = promptText(options)
			if (prompt.startsWith('You are reading one research request')) {
				return refuseTheParse
					? Effect.fail(
							new ProviderError({
								provider: 'custom',
								message: 'parse refused',
								recoverable: false,
							}),
						)
					: Effect.succeed({
							usage,
							value: {
								parts: [{ label: 'estructuras metálicas', terms: ['metal'] }],
								kindsOfCompany: [],
								askedBy: 'trade',
								place: '',
								places: [],
							},
						})
			}
			if (prompt.startsWith('You are checking a list returned by a search')) {
				kindCheckPrompts.push(prompt)
				return Effect.succeed({ usage, value: { verdicts: [] } })
			}
			// The extraction: one row, so the check has something to ask about.
			return Effect.succeed({
				usage,
				value: {
					[listField]: [
						{
							name: 'Prefabricats Exemple',
							why_relevant: 'Fabrica mòduls de formigó prefabricat.',
						},
					],
				},
			})
		}) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.succeed({ text: 'One maker found.', content: [], usage }) as never,
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

const eventSink = Layer.succeed(ResearchEventSink)(
	ResearchEventSink.of({ fire: () => Effect.void }),
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
const ORG = `asked-org-${randomUUID()}`
const USER = `asked-user-${randomUUID()}`
const TERMINAL = new Set([
	'succeeded',
	'succeeded_low_confidence',
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

const runToTheEnd = async (
	query: string,
	schemaName: 'prospect_scan_v1' | 'competitor_scan_v1',
): Promise<string> => {
	const created = await runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			return yield* svc.create(
				USER,
				ORG,
				{ query, schemaName, forceFresh: true },
				systemDefaults,
			)
		}),
	)
	const id = created.id
	if (id === undefined) throw new Error('the run was not created')
	for (let left = 120; left > 0; left--) {
		const row = await runtime.runPromise(
			Effect.gen(function* () {
				const svc = yield* ResearchService
				return (yield* svc.get(id).pipe(Effect.orDie)) as {
					status?: string
				} | null
			}),
		)
		const status = row?.status ?? 'unknown'
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

describe('what the company-kind check is told about the request', () => {
	describe('when a prospect scan’s request was read', () => {
		it('should put the kinds asked for to the model, in their own fence', async () => {
			// GIVEN a prospect scan whose request the parser split into one kind
			listField = 'prospects'
			refuseTheParse = false
			kindCheckPrompts.length = 0

			// WHEN the run goes to the end
			const status = await runToTheEnd(
				'Fabricantes de estructuras metálicas en Barcelona',
				'prospect_scan_v1',
			)

			// THEN the check was asked, and told the kind in a fence of its own
			expect(TERMINAL.has(status)).toBe(true)
			expect(kindCheckPrompts.length).toBeGreaterThan(0)
			expect(kindCheckPrompts[0] ?? '').toContain(
				'--- asked for ---\n"estructuras metálicas"\n--- end asked for ---',
			)
		})
	})

	describe('when the scan is a competitor scan', () => {
		it('should put the question exactly as it was, with nothing about the request', async () => {
			// GIVEN a competitor scan, whose request the parser reads just the same
			listField = 'competitors'
			refuseTheParse = false
			kindCheckPrompts.length = 0

			// WHEN the run goes to the end
			const status = await runToTheEnd(
				'Competidores de Prefabricats Exemple',
				'competitor_scan_v1',
			)

			// THEN the check was asked, with no fence of kinds and no line about
			//   other ways of asking
			expect(TERMINAL.has(status)).toBe(true)
			expect(kindCheckPrompts.length).toBeGreaterThan(0)
			expect(kindCheckPrompts[0] ?? '').not.toContain('--- asked for ---')
			expect(kindCheckPrompts[0] ?? '').not.toMatch(
				/by something other than their trade/,
			)
		})
	})

	describe('when the request parse was refused', () => {
		it('should put the question exactly as it was, since there is nothing to hand over', async () => {
			// GIVEN a prospect scan whose parse the provider refused
			listField = 'prospects'
			refuseTheParse = true
			kindCheckPrompts.length = 0

			// WHEN the run goes to the end
			const status = await runToTheEnd(
				'Fabricantes de estructuras metálicas en Barcelona',
				'prospect_scan_v1',
			)

			// THEN the run still finished and the check was asked the bare question
			expect(TERMINAL.has(status)).toBe(true)
			expect(kindCheckPrompts.length).toBeGreaterThan(0)
			expect(kindCheckPrompts[0] ?? '').not.toContain('--- asked for ---')
		})
	})
})
