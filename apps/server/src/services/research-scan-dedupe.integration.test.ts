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
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	ExtractLanguageModel,
	MapProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	readTextValue,
	ScrapeProvider,
	SearchProvider,
	SearchResult,
	SearchResultItem,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// That a company met twice comes back once, checked on the list a run actually
// stores rather than on the fold in isolation.
//
// A search meets one company under its own name and again for each branch office
// it publishes a page for — "Terre Solaire" beside "Terre Solaire – agence Lyon".
// The fold that joins those is covered field-by-field by unit tests next to it;
// what those cannot show is that it still holds with the whole chain running over
// the list afterwards, and that it holds for a company found in a *later* round,
// which is a different route into the list from the first reading.
//
// The two cases below are those two routes. Both assert the stored `findings`,
// because that is what a reader is handed.
//
// One shared ResearchService layer drives both (a fresh layer per case would open
// a fresh dispatcher + connection pool each time and exhaust the CI database's
// connection cap). Each test sets the module-level `scenario` before it runs, and
// the stubs read it at call time.

interface Org {
	id: string
	name: string
	slug: string
}

interface Scenario {
	/** Page text the one "fetched" search result carries. */
	readonly evidence: string
	/**
	 * What each extraction answers with, in order. The last stands for every
	 * extraction after it, so a case that only cares about the first reading
	 * states one.
	 */
	readonly readings: ReadonlyArray<Record<string, unknown>>
}

let scenario: Scenario
let extractionsSoFar = 0

// The opening line of the extraction prompt, and of nothing else. A scan puts two
// different questions to the extract model — read the evidence into findings, and
// audit the fields those findings claim — and only the first is what a reading
// answers. Telling them apart by the question rather than by counting calls keeps
// the script right whatever else the pipeline decides to ask along the way.
const EXTRACTION_OPENER = 'Produce structured findings STRICTLY'

const nextReading = (): Record<string, unknown> => {
	const at = Math.min(extractionsSoFar, scenario.readings.length - 1)
	extractionsSoFar++
	return scenario.readings[at] ?? {}
}

// A canonical URL hashes to itself, so this matches what the run fiber's
// source-linking computes for the web_search result below.
const SEED_URL = 'https://annuaire.test/installateurs'
const SEED_URL_HASH = createHash('sha256').update(SEED_URL).digest('hex')

// The page a later round's focused search brings back.
const GAP_URL = 'https://annuaire.test/terre-solaire-lyon'
const GAP_URL_HASH = createHash('sha256').update(GAP_URL).digest('hex')
const GAP_EVIDENCE =
	"Terre Solaire – agence Lyon, l'agence lyonnaise de l'installateur photovoltaïque Terre Solaire."

const usage = {
	inputTokens: {
		uncached: undefined,
		total: 0,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 0, text: undefined, reasoning: undefined },
}

// Agent pass: hand back one web_search result carrying real page text, and no
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
					result: { items: [{ url: SEED_URL, content: scenario.evidence }] },
				},
			],
			finishReason: 'stop' as const,
			usage,
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	// An audit gets an empty verdict list, which passes every field it was asked
	// about; only a reading advances the script.
	generateObject: ((options: { readonly prompt: string }) =>
		Effect.succeed({
			usage,
			value: options.prompt.startsWith(EXTRACTION_OPENER)
				? nextReading()
				: { verdicts: [] },
		})) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.succeed({ text: '## Scan brief', content: [], usage }) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// Nothing else here is reached: a run whose rows cite no page never fetches one,
// and neither the site map nor a company register is consulted by a scan.
const die = 'provider not exercised'

// A later round only re-reads when its focused searches actually brought a page
// back — with nothing new in the evidence it stops rather than asking the same
// question twice. So the search answers, and answering is what carries the run
// as far as the second reading.
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({
			search: () =>
				Effect.succeed(
					new SearchResult({
						units: 1,
						items: [
							new SearchResultItem({
								url: GAP_URL,
								title: 'Terre Solaire — agence de Lyon',
								snippet: 'Agence de Lyon',
								content: GAP_EVIDENCE,
							}),
						],
					}),
				),
		}),
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

const ctx = { org: undefined as unknown as Org }
let userId: string
const createdRunIds: string[] = []

interface StoredRow {
	readonly name: string
	readonly location: string | null
}

// Run one scan to its terminal state and report the list it stored.
const runScan = async (args: {
	readonly query: string
	readonly scenario: Scenario
}): Promise<{
	status: string
	prospects: ReadonlyArray<StoredRow>
	/** How many readings the run asked for, so a case cannot pass vacuously. */
	readings: number
}> => {
	scenario = args.scenario
	extractionsSoFar = 0
	return runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const sql = yield* SqlClient.SqlClient
			const scoped = enterOrgScope(sql, { org: ctx.org, userId })
			const created = yield* scoped(
				svc.create(
					userId,
					ctx.org.id,
					{
						query: args.query,
						schemaName: 'prospect_scan_v1',
						forceFresh: true,
					},
					systemDefaults,
				),
			)
			// A non-selector input never fans out, so it always carries a run id;
			// rule out the confirm-required variant to keep the type honest.
			if (created.status === 'confirm_required')
				return yield* Effect.die(
					new Error('scan-dedupe test input should not fan out'),
				)
			createdRunIds.push(created.id)

			const poll = (
				attemptsLeft: number,
			): Effect.Effect<string, never, never> =>
				Effect.gen(function* () {
					const run = (yield* svc.get(created.id).pipe(Effect.orDie)) as {
						status?: string
					} | null
					const status = run?.status ?? 'unknown'
					if (TERMINAL.has(status) || attemptsLeft <= 0) return status
					yield* Effect.sleep('250 millis')
					return yield* poll(attemptsLeft - 1)
				})
			const status = yield* poll(120)

			const [stored] = yield* scoped(
				sql<{ findings: unknown }>`
					SELECT findings FROM research_runs WHERE id = ${created.id}::uuid
				`,
			)
			const list = (stored?.findings as { prospects?: unknown } | null)
				?.prospects
			const prospects = Array.isArray(list)
				? list.map(row => {
						const held = row as Record<string, unknown>
						return {
							name: String(held['name'] ?? ''),
							location: readTextValue(held['location']),
						}
					})
				: []
			return { status, prospects, readings: extractionsSoFar }
		}),
	)
}

// Five more installers beside the one under test, so the list is never thin
// enough to earn the refined retry — that retry re-reads from scratch and would
// make which reading answers which pass depend on it.
const OTHERS = [
	{ name: 'Voltaïque Nord', website: 'https://voltaiquenord.test' },
	{ name: 'Soleil Atlantique', website: 'https://soleilatlantique.test' },
	{ name: 'Énergie Cévennes', website: 'https://energiecevennes.test' },
	{ name: 'Photon Loire', website: 'https://photonloire.test' },
	{ name: 'Helios Provence', website: 'https://heliosprovence.test' },
].map(company => ({
	...company,
	why_relevant: 'Solar panel installer working across France.',
	citations: [],
}))

const PARENT = {
	name: 'Terre Solaire',
	website: 'https://terresolaire.test',
	why_relevant: 'Solar panel installer working across France.',
	citations: [],
}

const branch = (town: string) => ({
	name: `Terre Solaire – agence ${town}`,
	location: town,
	why_relevant: 'Solar panel installer working across France.',
	citations: [],
})

// The towns have to appear in the page a run read, or the check that holds a
// location to the evidence blanks it and the row stops looking like a branch.
const EVIDENCE = [
	'Annuaire des installateurs photovoltaïques en France.',
	'Terre Solaire, installateur photovoltaïque, avec ses agences de Douains, Lyon et Montpellier.',
	'Voltaïque Nord, Soleil Atlantique, Énergie Cévennes, Photon Loire et Helios Provence sont également des installateurs.',
].join('\n')

beforeAll(async () => {
	const seed = await runtime.runPromise(
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
			// The one source every pass "fetches", so the grounding gate passes and
			// each run reaches the list under test.
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (${`src-${randomUUID()}`}, 'web', 'it-stub', ${SEED_URL}, ${SEED_URL_HASH}, 'annuaire.test', 'seed')
				ON CONFLICT (url_hash) DO NOTHING
			`
			// The page a later round's search brings back, so what that round reads is
			// linked to the run like any other source.
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (${`src-${randomUUID()}`}, 'web', 'it-stub', ${GAP_URL}, ${GAP_URL_HASH}, 'annuaire.test', 'gap')
				ON CONFLICT (url_hash) DO NOTHING
			`
			return { org, userId: user.id }
		}),
	)
	ctx.org = seed.org
	userId = seed.userId
}, 60_000)

afterAll(async () => {
	await runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const id of createdRunIds) {
				yield* sql`DELETE FROM research_cache WHERE research_id = ${id}::uuid`
				yield* sql`DELETE FROM research_runs WHERE id = ${id}::uuid`
			}
			yield* sql`DELETE FROM sources WHERE url_hash IN (${SEED_URL_HASH}, ${GAP_URL_HASH})`
		}),
	)
	await runtime.dispose()
})

describe('a company met twice in one scan', () => {
	describe('when one reading names a company and its branch offices', () => {
		it('should store the company once, under its own name, with every town', async () => {
			// GIVEN a reading that names an installer and three of its branch offices,
			//   each carrying only the town it sits in
			const result = await runScan({
				query: 'Find solar panel installers in France',
				scenario: {
					evidence: EVIDENCE,
					readings: [
						{
							prospects: [
								PARENT,
								branch('Douains'),
								branch('Lyon'),
								branch('Montpellier'),
								...OTHERS,
							],
						},
					],
				},
			})

			// THEN the stored list holds one Terre Solaire, named as the company rather
			//   than as one of its branches, and none of the towns was dropped on the
			//   way — the whole chain runs over the list after the fold, so this is the
			//   list a reader is actually handed
			// A run that died after phase 2 wrote its list would still be read below,
			// so the list is only worth checking once the run itself stands up.
			expect(result.status).toBe('succeeded')
			const terreSolaire = result.prospects.filter(row =>
				row.name.startsWith('Terre Solaire'),
			)
			expect(terreSolaire.map(row => row.name)).toEqual(['Terre Solaire'])
			expect(terreSolaire[0]?.location).toContain('Douains')
			expect(terreSolaire[0]?.location).toContain('Lyon')
			expect(terreSolaire[0]?.location).toContain('Montpellier')
			expect(result.prospects).toHaveLength(6)
		}, 60_000)
	})

	describe('when a later round is what turns up the branch office', () => {
		it('should still store one company, keeping the town the round found', async () => {
			// GIVEN a first reading that names six installers and no branch at all, and
			//   a later round that comes back with one company's Lyon office
			const result = await runScan({
				query: 'Find solar panel installation companies across France',
				scenario: {
					evidence: EVIDENCE,
					readings: [
						{ prospects: [PARENT, ...OTHERS] },
						{ prospects: [branch('Lyon')] },
					],
				},
			})

			// THEN the branch joins the company it belongs to instead of being appended
			//   beside it. The fold that ran over the first reading never saw this row,
			//   so a list that only folded then would hand the reader seven companies
			//   where there are six
			// The run has to stand up, and the round has to have happened, for any of
			// this to mean anything.
			expect(result.status).toBe('succeeded')
			expect(result.readings).toBeGreaterThan(1)
			expect(result.prospects).toHaveLength(6)
			expect(
				result.prospects.filter(row => row.name.startsWith('Terre Solaire')),
			).toHaveLength(1)
			expect(
				result.prospects.find(row => row.name === 'Terre Solaire')?.location,
			).toBe('Lyon')
		}, 60_000)
	})
})
