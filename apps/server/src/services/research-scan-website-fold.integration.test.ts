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
	SearchResult,
	SearchResultItem,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// The website fold: a trade body's member page must not be stored as a company's
// website, checked on the list a run really keeps rather than on one reading of it.
//
// A trade body gives each of its members a page on its own host. Two members are
// two companies claiming one host, which the website check condemns — but only
// when it is looking at both of them, and a run reads its list several times and
// folds the readings together afterwards. A member met in the first reading is
// alone on that host while it is judged, so it keeps the address; the round that
// finds the second member blanks the round's copy of both, and the fold then
// hands the reader the first reading's copy, address and all.
//
// So the run has to remember which company claimed which host, as claimed and
// before any blanking, and put the folded list back to the check with that
// memory. The claims and the rule are covered field-by-field by unit tests beside
// them; what those cannot show is that the run actually carries the claims from
// one reading to the next and checks the list it stores. This does.

interface Org {
	id: string
	name: string
	slug: string
}

interface Scenario {
	readonly evidence: string
	/**
	 * What each extraction answers with, in order. The last stands for every
	 * extraction after it.
	 */
	readonly readings: ReadonlyArray<Record<string, unknown>>
}

let scenario: Scenario
let extractionsSoFar = 0

// The opening line of the extraction prompt, and of nothing else. A scan puts two
// different questions to the extract model — read the evidence into findings, and
// audit the fields those findings claim — and only the first is what a reading
// answers.
const EXTRACTION_OPENER = 'Produce structured findings STRICTLY'

const nextReading = (): Record<string, unknown> => {
	const at = Math.min(extractionsSoFar, scenario.readings.length - 1)
	extractionsSoFar++
	return scenario.readings[at] ?? {}
}

// A canonical URL hashes to itself, so this matches what the run fiber's
// source-linking computes for the web_search result below.
const SEED_URL = 'https://directorio.test/instaladores'
const SEED_URL_HASH = createHash('sha256').update(SEED_URL).digest('hex')

// The page a later round's focused search brings back.
const GAP_URL = 'https://directorio.test/instalaciones-rubio'
const GAP_URL_HASH = createHash('sha256').update(GAP_URL).digest('hex')
const GAP_EVIDENCE =
	'Instalaciones Rubio, empresa instaladora eléctrica, socia de la asociación.'

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
const unused = 'provider not exercised'

// A later round only re-reads when its focused searches actually brought a page
// back, so the search answers and that is what carries the run to a second
// reading.
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
								title: 'Instalaciones Rubio',
								snippet: 'Empresa instaladora',
								content: GAP_EVIDENCE,
							}),
						],
					}),
				),
		}),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
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
	readonly website: string | null
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
					new Error('website-fold test input should not fan out'),
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
							website:
								typeof held['website'] === 'string' ? held['website'] : null,
						}
					})
				: []
			return { status, prospects, readings: extractionsSoFar }
		}),
	)
}

// The trade body's own host. It spells none of its members, so nothing can
// establish it as any of their sites — what condemns it is two of them claiming
// it, which is the evidence a single reading cannot hold.
const MEMBER_HOST = 'aemiat.com'

const installer = (name: string, website: string) => ({
	name,
	website,
	why_relevant: 'Empresa instaladora que trabaja en España.',
	citations: [],
})

// Five installers on their own sites beside the two under test, so the list is
// never thin enough to earn the refined retry — that retry re-reads from scratch
// and would make which reading answers which pass depend on it. They are also
// what says the fix costs no real website: every one of them has to survive.
const OTHERS = [
	installer('Electroluz Navarra', 'https://electroluznavarra.test'),
	installer('Climatiza Duero', 'https://climatizaduero.test'),
	installer('Fontanería Sagasta', 'https://fontaneriasagasta.test'),
	installer('Ascensores Ebro', 'https://ascensoresebro.test'),
	installer('Ignífuga Levante', 'https://ignifugalevante.test'),
]

const MORA = installer('Electricidad Mora', `https://${MEMBER_HOST}/e-mora/`)
const RUBIO = installer('Instalaciones Rubio', `https://${MEMBER_HOST}/rubio/`)

// Every company has to be named in a page the run read, or the checks that hold a
// row to the evidence drop it before the website is ever weighed.
const EVIDENCE = [
	'Directorio de empresas instaladoras en España.',
	'Electricidad Mora e Instalaciones Rubio son socias de la asociación.',
	'Electroluz Navarra, Climatiza Duero, Fontanería Sagasta, Ascensores Ebro e Ignífuga Levante también son empresas instaladoras.',
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
				VALUES (${`src-${randomUUID()}`}, 'web', 'it-stub', ${SEED_URL}, ${SEED_URL_HASH}, 'directorio.test', 'seed')
				ON CONFLICT (url_hash) DO NOTHING
			`
			// The page a later round's search brings back, so what that round reads is
			// linked to the run like any other source.
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (${`src-${randomUUID()}`}, 'web', 'it-stub', ${GAP_URL}, ${GAP_URL_HASH}, 'directorio.test', 'gap')
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

describe('two members of a trade body met a round apart', () => {
	describe('when only a later round names the second member', () => {
		it('should store neither of them on the trade body host', async () => {
			// GIVEN a first reading that puts one member on the trade body's host with
			//   nobody else on it, and a later round that names the second member there
			const result = await runScan({
				query: 'Empresas instaladoras en España',
				scenario: {
					evidence: EVIDENCE,
					readings: [
						{ prospects: [MORA, ...OTHERS] },
						{ prospects: [MORA, RUBIO, ...OTHERS] },
					],
				},
			})

			// THEN the run itself stood up and did reach the round that names the
			//   second member — the list below is only worth reading once both are
			//   true, since a run that died stores no list to find the address in
			expect(result.status).toBe('succeeded')
			expect(result.readings).toBeGreaterThan(1)

			// AND both members are still on the list, each of them with no site. The
			//   sibling failure to this one is the fold reading the shared address as
			//   proof the two rows are one company and dropping the second, which
			//   would empty the address check below without anything having been
			//   checked — so the rows are counted before the addresses are read
			expect(
				[MORA, RUBIO].map(
					member =>
						result.prospects.find(row => row.name === member.name)?.website,
				),
			).toEqual([null, null])

			// AND the address is on no row at all. The first reading had one claimant
			//   and kept it, the round had two and blanked the round's copy of both —
			//   so only the claims the run carried from one reading to the next can
			//   take it off the row the fold handed back
			expect(
				result.prospects
					.filter(row => row.website?.includes(MEMBER_HOST))
					.map(row => row.name),
			).toEqual([])

			// AND every installer that gave its own site still has it: carrying the
			//   claims counts companies, and a host one company claims is still that
			//   company's
			expect(
				OTHERS.map(
					other =>
						result.prospects.find(row => row.name === other.name)?.website,
				),
			).toEqual(OTHERS.map(other => other.website))
		}, 60_000)
	})
})
