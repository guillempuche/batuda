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
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client'

// A run about a company already on file is shown what the record holds so it
// can propose a correction. The columns it holds nothing in are shown too, as
// null, because the model is asked to fill what is missing and can only fill a
// gap it can see — and the website, applied as a channel rather than a column,
// is among them. Every run anchored to a subject gets that picture, so the
// three shapes that take one are driven through the real service here and
// the prompt each was handed is read back.

// One page the searching model always comes back with, so the run has
// something to read and the pass that proposes updates is reached.
const SEED_URL = 'https://taller-buit.test/sobre'
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

// Every prompt the searching model and the reading model were handed, as text.
const promptsSeen: string[] = []
const remember = (options: unknown): void => {
	promptsSeen.push(JSON.stringify(options))
}

const agentLlm: LanguageModel.Service = {
	generateText: (options: unknown) =>
		Effect.sync(() => {
			remember(options)
			return {
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
									content: 'Taller Buit is a workshop in Celrà.',
								},
							],
						},
					},
				],
				finishReason: 'stop' as const,
				usage,
			}
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	generateObject: (options: unknown) =>
		Effect.sync(() => {
			remember(options)
			const prompt = (options as { prompt?: unknown }).prompt
			const text =
				typeof prompt === 'string' ? prompt : JSON.stringify(prompt ?? '')
			if (text.startsWith('You are reading one research request')) {
				return {
					usage,
					value: {
						parts: [],
						kindsOfCompany: [],
						askedBy: 'trade',
						place: '',
						places: [],
					},
				}
			}
			if (
				text.startsWith('You are checking a list returned by a search') ||
				text.startsWith('You are auditing extracted CRM fields')
			) {
				return { usage, value: { verdicts: [] } }
			}
			return { usage, value: {} }
		}) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.succeed({ text: 'Nothing found.', content: [], usage }) as never,
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
const ORG = `columns-org-${randomUUID()}`
const USER = `columns-user-${randomUUID()}`
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

type Schema =
	| 'company_enrichment_v1'
	| 'contact_discovery_v1'
	| 'prospect_scan_v1'

let pool: pg.Pool
let companyId: string

const runToTheEnd = async (
	query: string,
	schemaName: Schema,
): Promise<string> => {
	const created = await runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			return yield* svc.create(
				USER,
				ORG,
				{
					query,
					schemaName,
					forceFresh: true,
					context: { subjects: [{ table: 'companies', id: companyId }] },
				},
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

// The on-file picture reaches the model inside a JSON string, so its quotes
// arrive escaped; the prompts are read the same way.
const shown = (field: string, value: string): string =>
	JSON.stringify(`"${field}": ${value}`).slice(1, -1)

const somePromptShows = (field: string, value: string): boolean =>
	promptsSeen.some(prompt => prompt.includes(shown(field, value)))

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// A company with a name and nothing else: no site, no size, no trade.
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Taller Buit') RETURNING id`,
		[ORG, `taller-buit-${randomUUID()}`],
	)
	const id = company.rows[0]?.id
	if (id === undefined) throw new Error('the company was not created')
	companyId = id
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'stub', $2, $3, 'taller-buit.test', 'seed')
		 ON CONFLICT (url_hash) DO NOTHING`,
		[`src-${randomUUID()}`, SEED_URL, SEED_URL_HASH],
	)
}, 30_000)

afterAll(async () => {
	// A run that succeeded left a cache row pointing at it, which has to go first.
	await pool.query(`DELETE FROM research_cache WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.query(`DELETE FROM sources WHERE url_hash = $1`, [SEED_URL_HASH])
	await runtime.dispose()
	await pool.end()
})

describe('what a run is shown of a company it already holds', () => {
	describe.each<[Schema, string]>([
		['company_enrichment_v1', 'Taller Buit, taller a Celrà. Omple les dades.'],
		['contact_discovery_v1', 'Qui mana a Taller Buit?'],
		['prospect_scan_v1', 'Tallers com Taller Buit a la província de Girona'],
	])('when a %s run is anchored to the company', (schemaName, query) => {
		it('should show the empty columns as null, the website among them', async () => {
			// GIVEN a company on file with a name and nothing else
			promptsSeen.length = 0

			// WHEN the run goes to the end
			const status = await runToTheEnd(query, schemaName)

			// THEN some prompt the models were handed shows the name as held and
			//   the site, the size and the trade as columns holding nothing
			expect(TERMINAL.has(status)).toBe(true)
			expect(somePromptShows('name', '"Taller Buit"')).toBe(true)
			expect(somePromptShows('website', 'null')).toBe(true)
			expect(somePromptShows('sizeRange', 'null')).toBe(true)
			expect(somePromptShows('industry', 'null')).toBe(true)
		})
	})

	describe('when the run may propose an update', () => {
		it('should be told the bands a size may take', async () => {
			// GIVEN an enrichment run, which proposes updates to the row
			promptsSeen.length = 0

			// WHEN the run goes to the end
			await runToTheEnd(
				'Taller Buit, taller a Celrà. Omple les dades.',
				'company_enrichment_v1',
			)

			// THEN the prompt that asks for proposals names the bands
			expect(
				promptsSeen.some(prompt =>
					prompt.includes('`sizeRange` takes one of these bands'),
				),
			).toBe(true)
		})
	})
})
