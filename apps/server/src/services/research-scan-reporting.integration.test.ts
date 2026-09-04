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
	/**
	 * Structured findings the extractor returns, one entry per extraction in the
	 * order they are asked for; the last entry answers every extraction after it.
	 * A list rather than one answer because a scan pinned to a company extracts
	 * twice, and a case about the two disagreeing has to be able to say so.
	 */
	readonly findings: ReadonlyArray<Record<string, unknown>>
	/**
	 * What the splitter says the request asks for. Absent means the request named
	 * one kind of company, which is what every scan here but the coverage one is.
	 */
	readonly parts?: ReadonlyArray<{
		readonly label: string
		readonly terms: ReadonlyArray<string>
	}>
	/**
	 * Whether the agent keeps asking for tools rather than settling. Set for a
	 * case about a search that was stopped at a ceiling: every other scan here
	 * has the model finish of its own accord after one pass.
	 */
	readonly neverSettles?: boolean
	/**
	 * How many rounds the agent keeps asking for tools before it settles. Set for
	 * a case about a first pass stopped at a ceiling and a second that settles:
	 * the round cap here is 4, so a value of 4 runs the first pass into it and
	 * lets the pass sent out after it finish on its own.
	 */
	readonly settlesAfterRounds?: number
	/**
	 * The area the splitter reads out of the request. Absent — every other case
	 * here — leaves the run nothing to hold its rows to, which is how a request
	 * naming no place reads.
	 */
	readonly place?: string
	/** What the place judge says about every row it is handed. */
	readonly placeVerdict?: 'inside' | 'outside' | 'unclear'
}

// Rounds the agent has been asked for across every pass of the current run.
let agentRounds = 0

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

// Agent pass: hand back two web_search results carrying real page text, so
// every pass gathers the seeded sources.
const agentLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.sync(() => {
			agentRounds++
			return {
				text: '',
				content: [],
				reasoning: [],
				reasoningText: undefined,
				// An empty list is the model settling, which ends the loop. A scenario
				// that never settles keeps asking, so the loop runs until a ceiling
				// stops it — which is the only way to reach that reporting from here.
				toolCalls:
					scenario.neverSettles ||
					(scenario.settlesAfterRounds !== undefined &&
						agentRounds <= scenario.settlesAfterRounds)
						? [{ id: 'again', name: 'web_search', params: { query: 'more' } }]
						: [],
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
			}
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// The extract tier answers two different questions on a scan: first what kinds of
// company the request asks for, then the structured findings. They are told apart
// by a phrase only the splitting prompt carries.
const SPLITTER_MARKER = 'kinds of company it asks for'
// A phrase only the organisation-kind question carries, so a reading and a kind
// check are never mistaken for one another.
const ORGANISATION_KIND_MARKER =
	'You are checking a list returned by a search for companies in a trade.'
// And a phrase only the place check carries, so where a row is and what kind of
// thing it is are never answered with each other's script.
const PLACE_JUDGE_MARKER =
	'You are checking a list of companies a search returned for a request confined to one area.'

// How many splitting prompts the stub recognised. A case that expects parts asserts
// on this, so rewording the splitting prompt fails as "the stub never saw the
// splitter" rather than as a puzzling status somewhere downstream.
let splitterCalls = 0

// Answers the extract tier gave that were not the splitter. On the scans below
// that is one per extraction, which is what tells an anchored scan (it extracts
// again in phase 2) from an open-ended one (it reuses phase 1's) — but the same
// tier also answers the rescues and the critic, so every case pins this count.
// An extra caller then fails here, loudly, instead of quietly handing the next
// scripted answer to the wrong extraction.
let extractionCalls = 0

const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ text: '', content: [], usage }) as never,
	generateObject: ((options: { readonly prompt?: unknown }) =>
		Effect.sync(() => {
			const isSplitter =
				typeof options.prompt === 'string' &&
				options.prompt.includes(SPLITTER_MARKER)
			if (isSplitter) {
				splitterCalls++
				return {
					usage,
					value: { parts: scenario.parts ?? [], place: scenario.place ?? '' },
				}
			}
			// The place check asks the same tier where each row is. Every row gets
			// the case's own verdict, keyed back to the ids the prompt itself hands
			// out — reading them off the prompt rather than counting rows, so a case
			// fails as "the judge answered nobody" if that numbering ever changes.
			if (
				typeof options.prompt === 'string' &&
				options.prompt.includes(PLACE_JUDGE_MARKER)
			) {
				const where = scenario.placeVerdict ?? 'unclear'
				const ids = [...options.prompt.matchAll(/^\[(r\d+)\]/gm)].map(
					match => match[1],
				)
				return {
					usage,
					value: {
						verdicts: ids.map(id => ({
							id,
							where,
							...(where === 'outside'
								? { reason: 'stated somewhere else' }
								: {}),
						})),
					},
				}
			}
			// The organisation-kind check asks the same model what each row is. It
			// passes every row here — this file is about what a scan reports, not
			// about which rows survive — and it must not count as a reading, or the
			// script below serves the next extraction somebody else's answer.
			if (
				typeof options.prompt === 'string' &&
				options.prompt.includes(ORGANISATION_KIND_MARKER)
			) {
				return { usage, value: { verdicts: [] } }
			}
			extractionCalls++
			// Past the end of the list, the last answer stands — a case that does not
			// care how many extractions ran gives one answer and gets it every time.
			// Extractions are issued one at a time, so the count picks the answer the
			// case scripted for this point in the run.
			return {
				usage,
				value:
					scenario.findings[
						Math.min(extractionCalls - 1, scenario.findings.length - 1)
					] ?? {},
			}
		})) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// What the writer was told to close the brief with. A case asserts on it,
// because the shortfall paragraph is the half of this a person actually reads.
let briefPrompt = ''

const writerLlm: LanguageModel.Service = {
	generateText: ((options: { readonly prompt?: unknown }) =>
		Effect.sync(() => {
			if (typeof options.prompt === 'string') briefPrompt = options.prompt
			return { text: '## Scan brief', content: [], usage }
		})) as never,
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

// One line of the run's own tool log, as a finished run stores it.
interface StoredToolLogEntry {
	readonly timestamp?: string
	readonly type?: string
	readonly tool?: string
	readonly durationMs?: number
	readonly input?: { readonly phase?: number; readonly round?: number }
	readonly output?: {
		readonly phase?: number
		readonly round?: number
		readonly gapRounds?: number
	}
}

// What a finished run says about the parts of its request, read off its findings.
interface StoredCoverage {
	readonly covered?: ReadonlyArray<string>
	readonly uncovered?: ReadonlyArray<string>
	readonly unsearched?: ReadonlyArray<string>
	readonly thought_answered?: ReadonlyArray<string>
	readonly stopped_because?: string | null
}

// And what it says about the area it was asked about, read the same way.
interface StoredPlace {
	readonly asked: number
	readonly inside: number
	readonly outside: number
	readonly unclear: number
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
	searchingStopped: string | undefined
	place: StoredPlace | undefined
	splitterAsked: boolean
	extractions: number
	briefPrompt: string
	toolLog: ReadonlyArray<StoredToolLogEntry>
	citationsSeen: number | undefined
	citationsKept: number | undefined
	prospects: ReadonlyArray<string>
}> => {
	scenario = args.scenario
	firedEvents = []
	splitterCalls = 0
	extractionCalls = 0
	briefPrompt = ''
	agentRounds = 0
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
			const [row] = yield* sql<{ findings: unknown; toolLog: unknown }>`
				SELECT findings, tool_log AS "toolLog"
				FROM research_runs WHERE id = ${created.id}::uuid
			`
			const findings = row?.findings
			const quality =
				findings !== null && typeof findings === 'object'
					? (
							findings as {
								quality?: {
									coverage?: StoredCoverage
									searching_stopped?: string
									citations_seen?: number
									citations_kept?: number
									place?: StoredPlace
								}
							}
						).quality
					: undefined
			return {
				status,
				refined: firedEvents.includes('research.refining'),
				covering: firedEvents.includes('research.covering'),
				coverage: quality?.coverage,
				searchingStopped: quality?.searching_stopped,
				place: quality?.place,
				splitterAsked: splitterCalls > 0,
				extractions: extractionCalls,
				briefPrompt,
				toolLog: Array.isArray(row?.toolLog)
					? (row.toolLog as ReadonlyArray<StoredToolLogEntry>)
					: [],
				citationsSeen: quality?.citations_seen,
				citationsKept: quality?.citations_kept,
				// The names left on the list, for a check about which rows a guard took
				// off rather than about what the run said of itself.
				prospects: (
					(findings as { prospects?: ReadonlyArray<{ name?: unknown }> } | null)
						?.prospects ?? []
				).flatMap(prospect =>
					typeof prospect.name === 'string' ? [prospect.name] : [],
				),
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
					findings: [
						{
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
					],
				},
			})

			// THEN the run took its one refined retry and, still thin, finished in
			//   the status that asks for a human read rather than as green as a run
			//   that came back with forty
			expect(result.refined).toBe(true)
			expect(result.status).toBe('succeeded_low_confidence')
		}, 60_000)
	})

	describe('when a scan for one kind of company comes back with almost nobody', () => {
		it('should say the searching finished rather than leave a short list unexplained', async () => {
			// GIVEN a request naming a single kind of company — so there is no list
			//   of parts to hold it to and no coverage reading at all — answered by
			//   two companies, with the model settling of its own accord
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query:
					'Independent multi-location auto repair groups in Greater Houston, Texas',
				scenario: {
					evidence:
						'A directory of independent multi-location auto repair groups in Houston.',
					findings: [
						{
							prospects: [
								{
									name: 'Bayou Auto Group',
									why_relevant: 'Independent repair group, four Houston shops',
									citations: [],
								},
								{
									name: 'Katy Service Partners',
									why_relevant: 'Independent repair group, two Houston shops',
									citations: [],
								},
							],
						},
					],
				},
			})

			// THEN the run still answers whether it had finished looking, which is
			//   what tells a thin market from a search that stopped — and the
			//   coverage block, which needs two kinds of company to mean anything,
			//   is rightly absent
			expect(result.coverage).toBeUndefined()
			expect(result.searchingStopped).toBe('finished_looking')
			// AND the brief says nothing about a ceiling, because there was none to
			//   report — the sentence exists to correct a reading that would be
			//   wrong, and here the plain reading of the list is the right one
			expect(result.briefPrompt).not.toContain('did not finish looking')
		}, 60_000)
	})

	describe('when a scan meets one operator filing itself as a company', () => {
		it('should take that row off the list and leave the real company', async () => {
			// GIVEN a request naming a town and its province, and a list holding one
			//   row whose only evidence is a domain that says Barcelona, files its page
			//   under Ripollet, and spells the company it carries — beside an ordinary
			//   firm on its own site
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query:
					'Empresas fabricantes industriales con taller propio en Ripollet (Barcelona)',
				scenario: {
					place: 'Ripollet (Barcelona)',
					placeVerdict: 'inside',
					evidence:
						'A list of industrial manufacturers with their own workshops.',
					findings: [
						{
							prospects: [
								{
									name: 'VKS Estampacions Metalúrgiques',
									why_relevant:
										'Fabricació de peces estampades amb taller propi',
									website: {
										value:
											'https://www.vksestampacionsmetalurgiquesbarcelona.es/ripollet',
										source_id: SEED_URL,
										confidence: 1,
									},
									citations: [
										{
											source_id:
												'https://www.vksestampacionsmetalurgiquesbarcelona.es/ripollet',
											confidence: 1,
										},
									],
								},
								{
									name: 'Cablestyl Fabricació de Cables',
									why_relevant: 'Fabricant de cables especials a mida',
									citations: [{ source_id: SEED_URL, confidence: 1 }],
								},
							],
						},
					],
				},
			})

			// THEN the operator's row is gone and the real company is untouched. The
			//   check runs inside the run rather than on the way out, so a reader and
			//   an assistant are handed the same list.
			expect(result.prospects).toContain('Cablestyl Fabricació de Cables')
			expect(result.prospects).not.toContain('VKS Estampacions Metalúrgiques')
		}, 60_000)
	})

	describe('when a scan is stopped at a ceiling with more it would have done', () => {
		it('should name the ceiling rather than report having finished looking', async () => {
			// GIVEN a scan whose model never settles, so the gathering runs until
			//   the round cap stops it
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query:
					'Independent multi-location auto repair groups in the Austin metropolitan area, Texas',
				scenario: {
					neverSettles: true,
					evidence:
						'A directory of independent multi-location auto repair groups in Austin.',
					findings: [
						{
							prospects: [
								{
									name: 'Colorado River Automotive',
									why_relevant: 'Independent repair group, three Austin shops',
									citations: [],
								},
							],
						},
					],
				},
			})

			// THEN the short list is reported as where the run was cut off. Without
			//   this the same one-company answer reads as a market with one such
			//   firm in it, and those two call for opposite next steps
			expect(result.searchingStopped).toBe('round_cap_reached')
			// AND the person reading the brief is told too. The stored reason is for
			//   whatever calls this; the brief is the only part of a run most people
			//   ever read, so a shortfall it does not carry is one they never see
			expect(result.briefPrompt).toContain('did not finish looking')
		}, 60_000)

		it('should keep that ceiling when a later stretch of looking settles', async () => {
			// GIVEN a scan whose model asks for tools through the whole of the first
			//   pass — so its round cap stops it — and then settles, which is what
			//   the pass sent out after a thin list does
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query:
					'Independent multi-location auto repair groups in the Austin metropolitan area, Texas',
				scenario: {
					settlesAfterRounds: 4,
					evidence:
						'A directory of independent multi-location auto repair groups in Austin.',
					findings: [
						{
							prospects: [
								{
									name: 'Colorado River Automotive',
									why_relevant: 'Independent repair group, three Austin shops',
									citations: [],
								},
							],
						},
					],
				},
			})

			// THEN the ceiling the first pass met is what the run reports. Reading
			//   only the last pass would call this run finished, which is the one
			//   answer it must not give: the looking was cut short before the pass
			//   that settled ever ran
			expect(result.searchingStopped).toBe('round_cap_reached')
			expect(result.briefPrompt).toContain('did not finish looking')
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
					findings: [
						{
							prospects: Array.from({ length: 6 }, (_, index) => ({
								name: `Electro Instal ${index}`,
								why_relevant: 'Instalaciones eléctricas industriales',
								citations: [],
							})),
						},
					],
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
			// AND neither is named as unsearched: the run went out for both of them
			//   and came back with nobody, which is a different answer from never
			//   having looked
			expect(result.coverage?.unsearched).toEqual([])
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
					findings: [
						{
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
					],
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

	describe('what a finished run records about its own work', () => {
		it('should bracket every call it logs with a result that carries a duration', async () => {
			// GIVEN an ordinary scan
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'empresas de instalaciones eléctricas en España',
				scenario: {
					evidence: 'Electro Instal SL — instalaciones eléctricas en Madrid.',
					findings: [
						{
							prospects: [
								{
									name: 'Electro Instal SL',
									why_relevant: 'Instalaciones eléctricas en Madrid',
									citations: [],
								},
							],
						},
					],
				},
			})

			// THEN every call has a result, and every result says how long the work
			//   between them took. Both entries of a pair used to be written after
			//   the work returned, so they carried the same instant and a fourteen
			//   minute run read as eight things that each took no time.
			const calls = result.toolLog.filter(entry => entry.type === 'call')
			const results = result.toolLog.filter(entry => entry.type === 'result')
			expect(calls.length).toBeGreaterThan(0)
			for (const call of calls) {
				expect(results.some(entry => entry.tool === call.tool)).toBe(true)
			}
			// AND the log reads in the order things happened. The round's opening
			//   entry was once stamped at the round's start but appended after the
			//   provider results it precedes, so sorting by timestamp reordered the
			//   array away from the order the work actually ran in.
			const stamps = result.toolLog.map(entry =>
				Date.parse(entry.timestamp ?? ''),
			)
			expect(stamps).toEqual([...stamps].sort((a, b) => a - b))
			// AND no round is reported that never ran. The gap-round entry used to be
			//   written when the loop turned rather than when a round was actually
			//   taken, so a run that closed every gap still reported one.
			const gapRounds = result.toolLog.filter(
				entry => entry.type === 'result' && entry.tool === 'research.gap_round',
			)
			const phase2 = result.toolLog.find(
				entry => entry.type === 'result' && entry.tool === 'llm.generateObject',
			)
			expect(gapRounds.length).toBe(phase2?.output?.gapRounds ?? 0)
			// AND each one opened as well as closed. A round is the longest quiet
			//   stretch of a run, so without an opening entry the log says nothing
			//   about a round still going, or about the round a run died inside.
			const gapRoundOpens = result.toolLog.filter(
				entry => entry.type === 'call' && entry.tool === 'research.gap_round',
			)
			expect(gapRoundOpens.length).toBe(gapRounds.length)
			// AND the gathering round in particular is timed. Keyed on the round
			//   rather than on the tool name, because the writer that produces the
			//   brief is another `llm.generateText` — matched by name alone, its
			//   duration stands in for the round's and the round can quietly stop
			//   carrying one without a test noticing.
			const roundCall = result.toolLog.find(
				entry =>
					entry.type === 'call' &&
					entry.tool === 'llm.generateText' &&
					entry.input?.round === 1,
			)
			const roundResult = result.toolLog.find(
				entry =>
					entry.type === 'result' &&
					entry.tool === 'llm.generateText' &&
					entry.output?.round === 1,
			)
			expect(roundCall).toBeDefined()
			expect(roundResult).toBeDefined()
			// The model here answers within the same millisecond, so what this can
			//   show is that a duration was measured and recorded — not that it is
			//   more than zero. That is the property that broke: both entries were
			//   written after the round returned and no duration was recorded at all.
			expect(roundResult?.durationMs).toBeGreaterThanOrEqual(0)
			// AND every timestamp parses as an ordinary date, so a reader can sort
			//   the log without knowing which library wrote it
			for (const entry of result.toolLog) {
				expect(Number.isNaN(Date.parse(entry.timestamp ?? ''))).toBe(false)
			}
		}, 60_000)

		it('should log the provider calls it made, not only the ones that failed', async () => {
			// GIVEN a scan whose searching and scraping all succeed
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'empresas de fontanería en Barcelona',
				scenario: {
					evidence: 'Fontanería Vall SL — reformas de baños en Barcelona.',
					findings: [
						{
							prospects: [
								{
									name: 'Fontanería Vall SL',
									why_relevant: 'Fontanería en Barcelona',
									citations: [],
								},
							],
						},
					],
				},
			})

			// THEN the searches and fetches are in the run's own log. Only failures
			//   used to be written, so a run that spent most of its money and its
			//   clock on provider calls left no trace of any of them, and a search
			//   that went out and found nothing read the same as one never made.
			const tools = new Set(result.toolLog.map(entry => entry.tool))
			expect(tools.has('web_search')).toBe(true)
			// AND the model's own phases are still bracketed alongside them
			expect(tools.has('llm.generateObject')).toBe(true)
		}, 60_000)

		it('should count the citations on the answer it ships', async () => {
			// GIVEN a scan whose rows cite a page the run really fetched
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'empresas de ascensores en Valencia',
				scenario: {
					evidence: 'Ascensores Vall SL — instalación de ascensores.',
					findings: [
						{
							prospects: [
								{
									name: 'Ascensores Vall SL',
									why_relevant: 'Instalación de ascensores en Valencia',
									citations: [
										{ source_id: SEED_URL, quote: 'Ascensores Vall SL' },
									],
								},
							],
						},
					],
				},
			})

			// THEN the tally describes the delivered list. It used to be assigned
			//   inside one extraction pass while the list a reader gets is the fold
			//   of every pass, so a live run reported 35 seen and 33 kept against 62
			//   citations actually shipped.
			expect(result.citationsSeen).toBe(1)
			expect(result.citationsKept).toBe(1)
		}, 60_000)

		it('should drop a citation to a page it never fetched', async () => {
			// GIVEN a scan whose row cites an address nothing in the run reached
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'empresas de climatización en Sevilla',
				scenario: {
					evidence: 'Clima Sur SL — climatización industrial en Sevilla.',
					findings: [
						{
							prospects: [
								{
									name: 'Clima Sur SL',
									why_relevant: 'Climatización industrial en Sevilla',
									citations: [
										{ source_id: SEED_URL, quote: 'Clima Sur SL' },
										{
											source_id: 'https://invented.test/never-fetched',
											quote: 'Clima Sur SL',
										},
									],
								},
							],
						},
					],
				},
			})

			// THEN the invented one is counted as offered and not as kept, so the
			//   pair says how much of what the model wrote was real
			expect(result.citationsSeen).toBe(2)
			expect(result.citationsKept).toBe(1)
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
					findings: [{ competitors: [] }],
				},
			})

			// THEN being pinned to a company costs it neither the retry nor the
			//   honest answer: it says it found nothing instead of reporting success
			//   over an empty list
			expect(result.refined).toBe(true)
			expect(result.status).toBe('no_reliable_data')
		}, 60_000)
	})

	describe('when a scan holds rows but reaches no page to stand them on', () => {
		it('should not report a trade covered by a list it throws away', async () => {
			// GIVEN a scan whose extraction hands back marble workers, but whose
			//   search results carry no page text — so nothing is fetched, the run
			//   cannot ground anything, and the list it was holding is discarded
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'Empresas en Girona: marbristas y ascensores',
				scenario: {
					evidence: '',
					parts: [
						{ label: 'marbristas', terms: ['marmolista', 'stone workshop'] },
						{ label: 'ascensores', terms: ['elevador', 'lift'] },
					],
					findings: [
						{
							prospects: Array.from({ length: 6 }, (_, index) => ({
								name: `Marbres Cerdanya ${index}`,
								why_relevant: 'Marbristas y piedra natural',
								citations: [],
							})),
						},
					],
				},
			})

			// THEN it says it found nothing reliable
			expect(result.status).toBe('no_reliable_data')
			// AND it claims no trade covered. The marble workers were real in memory
			//   and are not in what the run hands back, so reporting them covered
			//   would describe a list nobody receives — the same disagreement between
			//   two readings that the rest of this file exists to stop
			expect(result.coverage?.covered).toEqual([])
			expect(result.coverage?.uncovered).toEqual(['marbristas', 'ascensores'])
		}, 60_000)
	})

	describe('when a scan naming several trades comes back with nobody at all', () => {
		it('should still say which trades it was asked about and never looked for', async () => {
			// GIVEN a request naming two trades that finds no companies whatsoever —
			//   the run that ends before the reporting every other scan goes through
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'Empresas en Girona: marbristas y ascensores',
				scenario: {
					evidence: 'Directorio comarcal sin empresas listadas.',
					parts: [
						{ label: 'marbristas', terms: ['marmolista', 'stone workshop'] },
						{ label: 'ascensores', terms: ['elevador', 'lift'] },
					],
					findings: [{ prospects: [] }],
				},
			})

			// THEN it finishes saying it found nothing, as before
			expect(result.status).toBe('no_reliable_data')
			// AND it still reports what it was asked for: neither trade answered, and
			//   both named as ones nothing went looking for once the passes ran out.
			//   Without this the run that covered least is the one that says least,
			//   and nothing measuring coverage can see it at all
			expect(result.coverage?.covered).toEqual([])
			expect(result.coverage?.uncovered).toEqual(['marbristas', 'ascensores'])
			expect(result.coverage?.unsearched).toEqual([])
		}, 60_000)
	})

	describe('when a scan pinned to a company loses a trade between its two extractions', () => {
		it('should report the trade as one it never searched for', async () => {
			// GIVEN a prospect scan pinned to a company on file, naming two trades,
			//   whose first extraction answers both — so the search stops, having
			//   nothing left to look for — and whose second, the one the run
			//   reports on, comes back with the lift installers gone
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: `Find prospects like ${ANCHOR_NAME}: marbristas y ascensores`,
				subjectId: anchorCompanyId,
				scenario: {
					evidence: `${ANCHOR_NAME} is a natural stone workshop in Puigcerdà, Girona. Directorio de marbristas y de empresas de ascensores.`,
					parts: [
						{ label: 'marbristas', terms: ['marmolista', 'stone workshop'] },
						{ label: 'ascensores', terms: ['elevador', 'lift'] },
					],
					findings: [
						{
							prospects: [
								...Array.from({ length: 4 }, (_, index) => ({
									name: `Marbres Cerdanya ${index}`,
									why_relevant: 'Marbristas y piedra natural',
									citations: [],
								})),
								...Array.from({ length: 2 }, (_, index) => ({
									name: `Ascensors Pirineu ${index}`,
									why_relevant: 'Instalación de ascensores',
									citations: [],
								})),
							],
						},
						{
							prospects: Array.from({ length: 6 }, (_, index) => ({
								name: `Marbres Cerdanya ${index}`,
								why_relevant: 'Marbristas y piedra natural',
								citations: [],
							})),
						},
					],
				},
			})

			// THEN being pinned made it extract twice, and the second extraction is
			//   what it reports on — so the lifts genuinely have nobody in the list
			expect(result.extractions).toBe(2)
			expect(result.coverage?.covered).toEqual(['marbristas'])
			expect(result.coverage?.uncovered).toEqual(['ascensores'])
			// AND because the first extraction had answered them, no pass was ever
			//   spent looking for lifts — which is what the run says, instead of
			//   letting the shortfall read as a search that came back empty
			expect(result.covering).toBe(false)
			expect(result.coverage?.unsearched).toEqual(['ascensores'])
			// AND the trade is named as one the search finished believing it had
			//   found — the reading that tells this apart from a run the clock
			//   stopped before it could look
			expect(result.coverage?.thought_answered).toEqual(['ascensores'])
			expect(result.coverage?.stopped_because).toBe('answered')
			expect(result.status).toBe('succeeded_low_confidence')
			// AND the written brief is never told the search came back empty on it —
			//   that paragraph asserts a search that happened, so a trade nothing
			//   looked for is left out of it rather than named. The prompt is checked
			//   for content first: without that, a run whose writer never fired would
			//   pass this on an empty string
			expect(result.briefPrompt).toContain(
				'Begin with a single markdown heading',
			)
			expect(result.briefPrompt).not.toContain('came back empty')
			// AND it is told to say so plainly instead of passing over the trade in
			//   silence, which is what leaving it out of both lists would do
			expect(result.briefPrompt).toContain('never searched for')
			expect(result.briefPrompt).toContain('ascensores')
		}, 60_000)
	})

	describe('when a scan pinned to a company did go out for the trade it is missing', () => {
		it('should report it missing without naming it as one nothing looked for', async () => {
			// GIVEN the same pinned scan, but with every extraction answering only
			//   the marble workers — so the lifts read as missing while there was
			//   still a pass to spend, and the search went out for them
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: `Find prospects like ${ANCHOR_NAME}: marbristas y ascensores`,
				subjectId: anchorCompanyId,
				scenario: {
					evidence: `${ANCHOR_NAME} is a natural stone workshop in Puigcerdà, Girona. Directorio de marbristas y de empresas de ascensores.`,
					parts: [
						{ label: 'marbristas', terms: ['marmolista', 'stone workshop'] },
						{ label: 'ascensores', terms: ['elevador', 'lift'] },
					],
					findings: [
						{
							prospects: Array.from({ length: 6 }, (_, index) => ({
								name: `Marbres Cerdanya ${index}`,
								why_relevant: 'Marbristas y piedra natural',
								citations: [],
							})),
						},
					],
				},
			})

			// THEN the lifts are still missing from the list it reports — but the
			//   record of having gone out for them survives into phase 2's reading,
			//   so this reads as a search that came back empty, which is the one
			//   answer that says something about the market
			expect(result.covering).toBe(true)
			expect(result.coverage?.uncovered).toEqual(['ascensores'])
			expect(result.coverage?.unsearched).toEqual([])
			// AND it stopped having spent every pass it is allowed, not for want of
			//   anything to chase
			expect(result.coverage?.thought_answered).toEqual([])
			expect(result.coverage?.stopped_because).toBe('passes_spent')
			// AND the run says it was cut off, not that it finished looking. The
			//   chase for the trades nothing answered is looking too, so a run that
			//   ran out of passes mid-chase has not finished — and saying it had,
			//   next to a coverage block naming the chase it abandoned, would be the
			//   run contradicting itself in one breath
			expect(result.searchingStopped).toBe('round_cap_reached')
			expect(result.status).toBe('succeeded_low_confidence')
			// AND the written brief does name it, because here the search really did
			//   go out for it and come back with nobody
			expect(result.briefPrompt).toContain('came back empty')
			expect(result.briefPrompt).toContain('ascensores')
			expect(result.briefPrompt).not.toContain('never searched for')
		}, 60_000)
	})

	describe('when the same request runs open-ended', () => {
		it('should extract once and report every trade covered', async () => {
			// GIVEN the identical scenario with no company pinned — the control: one
			//   extraction, so the reading the search stopped on and the reading the
			//   run reports are the same one and cannot disagree
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query: 'Empresas en Girona: marbristas y ascensores',
				scenario: {
					evidence:
						'Directorio de marbristas y de empresas de ascensores en Girona.',
					parts: [
						{ label: 'marbristas', terms: ['marmolista', 'stone workshop'] },
						{ label: 'ascensores', terms: ['elevador', 'lift'] },
					],
					findings: [
						{
							prospects: [
								...Array.from({ length: 4 }, (_, index) => ({
									name: `Marbres Cerdanya ${index}`,
									why_relevant: 'Marbristas y piedra natural',
									citations: [],
								})),
								...Array.from({ length: 2 }, (_, index) => ({
									name: `Ascensors Pirineu ${index}`,
									why_relevant: 'Instalación de ascensores',
									citations: [],
								})),
							],
						},
						{
							prospects: Array.from({ length: 6 }, (_, index) => ({
								name: `Marbres Cerdanya ${index}`,
								why_relevant: 'Marbristas y piedra natural',
								citations: [],
							})),
						},
					],
				},
			})

			// THEN the second answer above is never asked for, both trades are
			//   answered, and nothing is reported as missing or as unsearched
			expect(result.extractions).toBe(1)
			expect(result.covering).toBe(false)
			expect(result.coverage?.uncovered).toEqual([])
			expect(result.coverage?.unsearched).toEqual([])
			expect(result.status).toBe('succeeded')
		}, 60_000)
	})

	describe('when the request names a place and the caller passed none', () => {
		it('should hold the list to the place it read out of the request', async () => {
			// GIVEN a request naming a town in its own words, with no place hint on
			//   the call — the shape every scan in production arrives in — and a
			//   judge that places every company somewhere else
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query:
					'Empresas fabricantes industriales con taller propio en Ripollet (Barcelona)',
				scenario: {
					evidence: 'A directory listing of Spanish industrial manufacturers.',
					place: 'Ripollet (Barcelona)',
					placeVerdict: 'outside',
					findings: [
						{
							prospects: Array.from({ length: 6 }, (_, index) => ({
								name: `Fabricacions Industrials ${index}`,
								why_relevant: 'Fabricante industrial con taller propio',
								citations: [
									{ source_id: SEED_URL, quote: 'Fabricante', confidence: 0.9 },
								],
							})),
						},
					],
				},
			})

			// THEN the check ran — which is the whole point, since the hint nobody
			//   fills is what used to leave it with nothing to hold rows to
			expect(result.place).toEqual({
				asked: 6,
				inside: 0,
				outside: 6,
				unclear: 0,
			})
			// AND a list with nobody in the area asked about does not finish as
			//   green as one that answered the question
			expect(result.status).toBe('succeeded_low_confidence')
		}, 60_000)

		it('should finish clean when the companies are in the place asked for', async () => {
			// GIVEN the same request and list, and a judge that places every company
			//   inside the area
			const result = await runScan({
				schemaName: 'prospect_scan_v1',
				query:
					'Empresas fabricantes industriales con taller propio en Ripollet (Barcelona)',
				scenario: {
					evidence: 'A directory listing of Spanish industrial manufacturers.',
					place: 'Ripollet (Barcelona)',
					placeVerdict: 'inside',
					findings: [
						{
							prospects: Array.from({ length: 6 }, (_, index) => ({
								name: `Tallers Ripollet ${index}`,
								why_relevant: 'Fabricante industrial con taller propio',
								citations: [
									{ source_id: SEED_URL, quote: 'Fabricante', confidence: 0.9 },
								],
							})),
						},
					],
				},
			})

			// THEN the same block is reported, and the run finishes plain succeeded:
			//   the flag is a floor, not a reading of how the list split
			expect(result.place).toEqual({
				asked: 6,
				inside: 6,
				outside: 0,
				unclear: 0,
			})
			expect(result.status).toBe('succeeded')
		}, 60_000)
	})
})
