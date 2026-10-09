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
import { OUTSIDE_REQUESTED_SIZE } from '@batuda/research/application/row-marks'

import { PgLive } from '../db/client'

// A request that writes a size band in its own words — "entre 5 y 250
// empleados" — and passes none as a filter has its final list held to that
// band: a row stating a headcount outside it is marked, never removed, and a
// row stating none is left alone. A caller that passes the band as a hint asked
// for the rows to be removed, and gets no mark on the ones that stay. This
// drives both through the real service and reads the list the run reports.

const SEED_URL = 'https://directory.test/makers-sized'
const SEED_URL_HASH = createHash('sha256').update(SEED_URL).digest('hex')
const SEED_TEXT =
	'Grande Prefabricats has 400 employees. Mitjana Prefabricats has 40 employees. Silenciosa Prefabricats makes concrete modules.'

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
					result: { items: [{ url: SEED_URL, content: SEED_TEXT }] },
				},
			],
			finishReason: 'stop' as const,
			usage,
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

type Reply = { readonly usage: typeof usage; readonly value: unknown }

const promptText = (options: unknown): string => {
	const prompt = (options as { prompt?: unknown }).prompt
	return typeof prompt === 'string' ? prompt : JSON.stringify(prompt ?? '')
}

const sized = (name: string, employees: number | undefined) => ({
	name,
	why_relevant: `${name} fabrica prefabricados de hormigón.`,
	citations: [{ source_id: SEED_URL, quote: `${name} ` }],
	...(employees === undefined
		? {}
		: {
				employee_estimate: {
					value: employees,
					source_id: SEED_URL,
					quote: `${name} has ${employees} employees.`,
				},
			}),
})

const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	generateObject: (options: unknown) =>
		Effect.suspend((): Effect.Effect<Reply> => {
			const prompt = promptText(options)
			if (prompt.startsWith('You are reading one research request')) {
				return Effect.succeed({
					usage,
					value: {
						parts: [
							{ label: 'prefabricados de hormigón', terms: ['prefabricats'] },
						],
						kindsOfCompany: [],
						askedBy: 'trade',
						minEmployees: 5,
						maxEmployees: 250,
						place: '',
						places: [],
					},
				})
			}
			// The kind check and the critic both answer with verdicts, and an
			// empty list from either leaves every row as it was.
			if (
				prompt.startsWith('You are checking a list returned by a search') ||
				prompt.startsWith('You are auditing extracted CRM fields')
			) {
				return Effect.succeed({ usage, value: { verdicts: [] } })
			}
			return Effect.succeed({
				usage,
				value: {
					prospects: [
						sized('Grande Prefabricats', 400),
						sized('Mitjana Prefabricats', 40),
						sized('Silenciosa Prefabricats', undefined),
					],
				},
			})
		}) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.succeed({
			text: 'Three makers found.',
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
const ORG = `size-org-${randomUUID()}`
const USER = `size-user-${randomUUID()}`
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
const QUERY =
	'Fabricantes de prefabricados de hormigón en Barcelona, entre 5 y 250 empleados'

type Row = { readonly name?: unknown; readonly marks?: unknown }

let pool: pg.Pool

const runToTheEnd = async (
	hints: { min_employees?: number; max_employees?: number } | undefined,
): Promise<{ status: string; prospects: ReadonlyArray<Row> }> => {
	const created = await runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			return yield* svc.create(
				USER,
				ORG,
				{
					query: QUERY,
					schemaName: 'prospect_scan_v1',
					forceFresh: true,
					...(hints === undefined ? {} : { context: { hints } }),
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
					findings?: { prospects?: ReadonlyArray<Row> }
				} | null
			}),
		)
		const status = row?.status ?? 'unknown'
		if (TERMINAL.has(status)) {
			const prospects = row?.findings?.prospects ?? []
			if (prospects.length === 0)
				throw new Error(
					`run ended ${status} with no list: ${JSON.stringify(row?.findings).slice(0, 600)}`,
				)
			return { status, prospects }
		}
		await new Promise(resolve => setTimeout(resolve, 250))
	}
	return { status: 'timeout', prospects: [] }
}

const marksOf = (rows: ReadonlyArray<Row>, name: string): unknown =>
	rows.find(row => row.name === name)?.marks

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
	// A run that succeeded left a cache row pointing at it, which has to go first.
	await pool.query(`DELETE FROM research_cache WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM sources WHERE url_hash = $1`, [SEED_URL_HASH])
	await runtime.dispose()
	await pool.end()
})

describe('the size band a request wrote', () => {
	describe('when the caller passed no size as a filter', () => {
		it('should mark the row outside the band and leave the others alone', async () => {
			// GIVEN a request writing "entre 5 y 250 empleados" and no size hint
			// WHEN the run goes to the end
			const { status, prospects } = await runToTheEnd(undefined)

			// THEN the run finished with its list, the 400-person firm carries
			//   the mark, and the firm inside the band and the silent one do not
			expect(TERMINAL.has(status)).toBe(true)
			expect(prospects.map(row => row.name)).toEqual(
				expect.arrayContaining([
					'Grande Prefabricats',
					'Mitjana Prefabricats',
					'Silenciosa Prefabricats',
				]),
			)
			//   (the existence check could not run here, so every row also carries
			//   the existence mark; the size mark is looked for rather than the
			//   marks compared whole)
			expect(marksOf(prospects, 'Grande Prefabricats')).toContain(
				OUTSIDE_REQUESTED_SIZE,
			)
			expect(marksOf(prospects, 'Mitjana Prefabricats') ?? []).not.toContain(
				OUTSIDE_REQUESTED_SIZE,
			)
			expect(marksOf(prospects, 'Silenciosa Prefabricats') ?? []).not.toContain(
				OUTSIDE_REQUESTED_SIZE,
			)
		})
	})

	describe('when the caller passed the band as a hint', () => {
		it('should remove the row outside it and mark nothing', async () => {
			// GIVEN the same request with the band passed as a filter
			// WHEN the run goes to the end
			const { status, prospects } = await runToTheEnd({
				min_employees: 5,
				max_employees: 250,
			})

			// THEN the 400-person firm is gone, as the caller asked, and no
			//   survivor carries a size mark
			expect(TERMINAL.has(status)).toBe(true)
			expect(prospects.map(row => row.name)).not.toContain(
				'Grande Prefabricats',
			)
			expect(prospects.map(row => row.name)).toContain('Mitjana Prefabricats')
			for (const row of prospects) {
				expect(row.marks ?? []).not.toContain(OUTSIDE_REQUESTED_SIZE)
			}
		})
	})
})
