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
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// What a discovery scan reports about itself, end to end. A scan that comes back
// with a handful of companies must not read as green as one that came back with
// a list; a scan asked about several trades that answers one of them must go back
// out for the rest and say which it never covered; and a scan pinned to a company
// — "find this company's competitors" — must earn the same refined retry and the
// same honest "found nothing" as an open-ended one, rather than reporting success
// over an empty list.
//
// One shared ResearchService layer drives every case (a fresh layer per case
// would start a fresh dispatcher + connection pool each time and exhaust the CI
// database's connection cap). Each test sets the module-level `scenario` before
// it runs, and the Agent/Extract stubs read it at call time.

interface Org {
	id: string
	name: string
	slug: string
}

interface Scenario {
	/** Page text the one "fetched" search result carries. */
	readonly evidence: string
	/** Structured findings the extractor returns on every call. */
	readonly findings: Record<string, unknown>
	/**
	 * What the splitter says the request asks for. Absent means the request named
	 * one kind of company, which is what every scan here but the coverage one is.
	 */
	readonly parts?: ReadonlyArray<{
		readonly label: string
		readonly terms: ReadonlyArray<string>
	}>
}

let scenario: Scenario

// A canonical URL hashes to itself, so this matches what the run fiber's
// source-linking computes for the web_search result below.
const SEED_URL = 'https://directory.test/scan-reporting'
const SEED_URL_HASH = createHash('sha256').update(SEED_URL).digest('hex')
// A second page, so a run here is never vetted against a single source. Without
// it every scan below would be marked for a read on that count alone, and no test
// could tell the signal it is about from that one.
const SECOND_URL = 'https://association.test/members'
const SECOND_URL_HASH = createHash('sha256').update(SECOND_URL).digest('hex')

// The company an anchored scan is launched from. Its name is distinctive enough
// that evidence naming it clears the entity gate — otherwise the run would fail
// closed there and never reach the reporting under test.
const ANCHOR_NAME = 'Marbrera Puigcerdà Pedra Natural'

const usage = {
	inputTokens: {
		uncached: undefined,
		total: 0,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 0, text: undefined, reasoning: undefined },
}

// Agent pass: hand back two web_search results carrying real page text, and no
// further tool calls, so each pass gathers the seeded sources then stops.
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
							{ url: SEED_URL, content: scenario.evidence },
							{ url: SECOND_URL, content: scenario.evidence },
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

// The extract tier answers two different questions on a scan: first what kinds of
// company the request asks for, then the structured findings. They are told apart
// by a phrase only the splitting prompt carries.
const SPLITTER_MARKER = 'kinds of company it asks for'

// How many splitting prompts the stub recognised. A case that expects parts asserts
// on this, so rewording the splitting prompt fails as "the stub never saw the
// splitter" rather than as a puzzling status somewhere downstream.
let splitterCalls = 0

const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	generateObject: ((options: { readonly prompt?: unknown }) =>
		Effect.sync(() => {
			const isSplitter =
				typeof options.prompt === 'string' &&
				options.prompt.includes(SPLITTER_MARKER)
			if (isSplitter) splitterCalls++
			return {
				usage,
				value: isSplitter ? { parts: scenario.parts ?? [] } : scenario.findings,
			}
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

// Every event a run fires, so a test can assert the refined retry ran.
let firedEvents: string[] = []
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
let anchorCompanyId: string
const createdRunIds: string[] = []

// What a finished run says about the parts of its request, read off its findings.
interface StoredCoverage {
	readonly covered?: ReadonlyArray<string>
	readonly uncovered?: ReadonlyArray<string>
}

// Run one scan to its terminal state and report how it finished.
const runScan = async (args: {
	readonly schemaName: string
	readonly query: string
	readonly scenario: Scenario
	readonly subjectId?: string
}): Promise<{
	status: string
	refined: boolean
	covering: boolean
	coverage: StoredCoverage | undefined
	splitterAsked: boolean
}> => {
	scenario = args.scenario
	firedEvents = []
	splitterCalls = 0
	return runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const sql = yield* SqlClient.SqlClient
			const created = yield* enterOrgScope(sql, { org: ctx.org, userId })(
				svc.create(
					userId,
					ctx.org.id,
					{
						query: args.query,
						schemaName: args.schemaName,
						forceFresh: true,
						...(args.subjectId
							? {
									context: {
										subjects: [{ table: 'companies', id: args.subjectId }],
									},
								}
							: {}),
					},
					systemDefaults,
				),
			)
			// A non-selector input never fans out, so it always carries a run id;
			// rule out the confirm-required variant to keep the type honest.
			if (created.status === 'confirm_required')
				return yield* Effect.die(
					new Error('scan-reporting test input should not fan out'),
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
			const [row] = yield* sql<{ findings: unknown }>`
				SELECT findings FROM research_runs WHERE id = ${created.id}::uuid
			`
			const findings = row?.findings
			const quality =
				findings !== null && typeof findings === 'object'
					? (findings as { quality?: { coverage?: StoredCoverage } }).quality
					: undefined
			return {
				status,
				refined: firedEvents.includes('research.refining'),
				covering: firedEvents.includes('research.covering'),
				coverage: quality?.coverage,
				splitterAsked: splitterCalls > 0,
			}
		}),
	)
}

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
			const [anchor] = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${org.id}, ${`scan-anchor-${randomUUID()}`}, ${ANCHOR_NAME})
				RETURNING id
			`
			// The one source both passes "fetch", so the grounding gate passes and
			// each run reaches the reporting under test.
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (${`src-${randomUUID()}`}, 'web', 'it-stub', ${SEED_URL}, ${SEED_URL_HASH}, 'directory.test', 'seed')
				ON CONFLICT (url_hash) DO NOTHING
			`
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (${`src-${randomUUID()}`}, 'web', 'it-stub', ${SECOND_URL}, ${SECOND_URL_HASH}, 'association.test', 'seed')
				ON CONFLICT (url_hash) DO NOTHING
			`
			return { org, userId: user.id, anchorId: anchor?.id ?? '' }
		}),
	)
	ctx.org = seed.org
	userId = seed.userId
	anchorCompanyId = seed.anchorId
}, 60_000)

afterAll(async () => {
	await runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const id of createdRunIds) {
				yield* sql`DELETE FROM research_cache WHERE research_id = ${id}::uuid`
				yield* sql`DELETE FROM research_runs WHERE id = ${id}::uuid`
			}
			yield* sql`DELETE FROM companies WHERE id = ${anchorCompanyId}::uuid`
			yield* sql`DELETE FROM sources WHERE url_hash = ${SEED_URL_HASH}`
			yield* sql`DELETE FROM sources WHERE url_hash = ${SECOND_URL_HASH}`
		}),
	)
	await runtime.dispose()
})

describe('what a discovery scan reports about itself', () => {
	describe('when an open-ended scan comes back with only a handful', () => {
		it('should search again and finish marked for a read, not plain succeeded', async () => {
			// GIVEN a prospect scan that finds two companies — a real answer, but far
			//   short of the list it was asked for
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'Find midsize US freight brokerage prospects',
				scenario: {
					evidence: 'A directory listing of US freight brokerage firms.',
					findings: {
						prospects: [
							{
								name: 'Ridgeline Freight',
								why_relevant: 'Midsize US broker',
								citations: [],
							},
							{
								name: 'Copperline Logistics',
								why_relevant: 'Midsize US broker',
								citations: [],
							},
						],
					},
				},
			})

			// THEN the run took its one refined retry and, still thin, finished in
			//   the status that asks for a human read rather than as green as a run
			//   that came back with forty
			expect(result.refined).toBe(true)
			expect(result.status).toBe('succeeded_low_confidence')
		}, 60_000)
	})

	describe('when a scan answers one of the trades its request named', () => {
		it('should search again for the rest and finish marked for a read', async () => {
			// GIVEN a request naming three trades, answered by six electricians and
			//   nobody else — a list long enough that nothing about its size is thin,
			//   which is the run this exists to catch
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query:
					'Empresas instaladoras en España: instalaciones eléctricas, fontanería y ascensores',
				scenario: {
					evidence: 'Directorio de empresas instaladoras eléctricas en España.',
					parts: [
						{
							label: 'instalaciones eléctricas',
							terms: ['electricista', 'electrical installation'],
						},
						{ label: 'fontanería', terms: ['fontanero', 'plumbing'] },
						{ label: 'ascensores', terms: ['elevador', 'lift'] },
					],
					findings: {
						prospects: Array.from({ length: 6 }, (_, index) => ({
							name: `Electro Instal ${index}`,
							why_relevant: 'Instalaciones eléctricas industriales',
							citations: [],
						})),
					},
				},
			})

			// THEN the run went back out for the two trades nothing answered, and
			//   finished asking for a read rather than reporting plain success over a
			//   third of the question — the list was never thin, so only coverage
			//   could have raised either
			expect(result.splitterAsked).toBe(true)
			expect(result.covering).toBe(true)
			expect(result.refined).toBe(false)
			expect(result.status).toBe('succeeded_low_confidence')
			// AND the shortfall is readable off the finished run, so nobody has to
			//   search again to learn what is missing
			expect(result.coverage?.covered).toEqual(['instalaciones eléctricas'])
			expect(result.coverage?.uncovered).toEqual(['fontanería', 'ascensores'])
		}, 60_000)
	})

	describe('when a scan answers every trade its request named', () => {
		it('should finish plain succeeded without searching again', async () => {
			// GIVEN a request naming two trades, with a company for each
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'Empresas instaladoras: instalaciones eléctricas y fontanería',
				scenario: {
					evidence: 'Directorio de empresas instaladoras en España.',
					parts: [
						{ label: 'instalaciones eléctricas', terms: ['electricista'] },
						{ label: 'fontanería', terms: ['fontanero'] },
					],
					findings: {
						prospects: [
							...Array.from({ length: 3 }, (_, index) => ({
								name: `Electro Instal ${index}`,
								why_relevant: 'Instalaciones eléctricas industriales',
								citations: [],
							})),
							...Array.from({ length: 3 }, (_, index) => ({
								name: `Fontaneria Vall ${index}`,
								why_relevant: 'Fontanería y reformas de baños',
								citations: [],
							})),
						],
					},
				},
			})

			// THEN nothing is missing, so no extra pass is spent and the run reports
			//   the plain success it earned
			expect(result.splitterAsked).toBe(true)
			expect(result.covering).toBe(false)
			expect(result.status).toBe('succeeded')
			expect(result.coverage?.uncovered).toEqual([])
		}, 60_000)
	})

	describe('when a scan pinned to a company finds nobody', () => {
		it('should search again and report having found nothing', async () => {
			// GIVEN a competitor scan launched from a company on file, whose evidence
			//   clearly names that company (so the entity gate passes) but whose
			//   competitor list comes back empty every time
			const result = await runScan({
				schemaName: 'competitor_scan_v1',
				query: `Find competitors of ${ANCHOR_NAME}`,
				subjectId: anchorCompanyId,
				scenario: {
					evidence: `${ANCHOR_NAME} is a natural stone workshop in Puigcerdà, Girona.`,
					findings: { competitors: [] },
				},
			})

			// THEN being pinned to a company costs it neither the retry nor the
			//   honest answer: it says it found nothing instead of reporting success
			//   over an empty list
			expect(result.refined).toBe(true)
			expect(result.status).toBe('no_reliable_data')
		}, 60_000)
	})
})
