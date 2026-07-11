// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'

import { createHash, randomUUID } from 'node:crypto'

import { Effect, Layer, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	type CreateResearchInput,
	ExtractLanguageModel,
	ExtractProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	type ScrapedPage,
	ScrapeProvider,
	SearchProvider,
	type SystemDefaults,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// The anchor path: a run whose caller wrote the company's own domain into the
// query grounds on that official site even when the model never fetches it. The
// Agent stub deliberately gathers nothing (an empty web_search, then a final
// answer) — the mirror of the dispatch suite's "scrapes nothing → no_reliable_data"
// — so the ONLY evidence is the site the fiber fetches up front from the domain.

interface Org {
	id: string
	name: string
	slug: string
}

// A domain unique per run so the seeded sources row can't collide across runs.
const ANCHOR_HOST = `acme-anchor-${randomUUID()}.example`
const ANCHOR_URL = `https://${ANCHOR_HOST}`
// canonicalizeUrl() runs the URL through `new URL().toString()`, which appends a
// trailing slash to a bare host — so the run links its source by this hash.
const ANCHOR_CANONICAL = new URL(ANCHOR_URL).toString()
const ANCHOR_URL_HASH = createHash('sha256')
	.update(ANCHOR_CANONICAL)
	.digest('hex')
// The official-site markdown spells the whole company name, so the entity gate
// strong-matches on the seeded page alone.
const ANCHOR_MARKDOWN =
	'Acme Anchor Logistics — freight forwarding based in Barcelona.'

const usage = {
	inputTokens: {
		uncached: undefined,
		total: 0,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 0, text: undefined, reasoning: undefined },
}

// Round 1: a forced tool call that grounds nothing (empty search results).
const searchRound = {
	text: '',
	content: [{ type: 'text' as const, text: 'Searching the web.' }],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [
		{
			id: 'w1',
			name: 'web_search',
			params: { query: 'acme anchor logistics' },
		},
	],
	toolResults: [
		{
			id: 'w1',
			name: 'web_search',
			result: { items: [] },
			encodedResult: undefined,
			isFailure: false,
		},
	],
	finishReason: 'tool-calls' as const,
	usage,
}

// Round 2: no tool calls, so the loop stops — the model gathered nothing itself.
const finalRound = {
	...searchRound,
	text: 'Could not find much on the open web.',
	content: [
		{ type: 'text' as const, text: 'Could not find much on the open web.' },
	],
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
}

let agentCall = 0
const agentLlm: LanguageModel.Service = {
	generateText: (_options: unknown) =>
		Effect.sync(() => (agentCall++ === 0 ? searchRound : finalRound)) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// The extractor produces a plain summary — no proposals to citation-check, so the
// run's success turns purely on the anchor site grounding it.
const extractLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.succeed(finalRound) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({
			...finalRound,
			value: {
				summary: 'Acme Anchor Logistics is a Barcelona freight forwarder.',
			},
		}) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: (_options: unknown) =>
		Effect.succeed({
			...finalRound,
			text: 'Acme Anchor Logistics is a Barcelona freight forwarder.',
		}) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// The fiber fetches the anchor site itself; every other provider dies so an
// accidental call fails loudly. Scraping anything but the anchor url is a bug.
const unused = 'research provider not exercised by this test'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({
			// ScrapedPage is re-exported as a type only, so hand back a plain object
			// of the same shape (the seed reads its url + markdown) rather than newing
			// the class. Any url but the anchor is a bug — the model fetches nothing.
			scrape: input =>
				input.url === ANCHOR_URL
					? Effect.succeed({
							url: ANCHOR_URL,
							markdown: ANCHOR_MARKDOWN,
							contentHash: createHash('sha256')
								.update(ANCHOR_MARKDOWN)
								.digest('hex'),
							units: 1,
						} as ScrapedPage)
					: Effect.die(`unexpected scrape url: ${input.url}`),
		}),
	),
	Layer.succeed(ExtractProvider)(
		ExtractProvider.of({ extract: () => Effect.die(unused) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
	),
)

const llmLayer = Layer.mergeAll(
	Layer.succeed(AgentLanguageModel)(agentLlm),
	Layer.succeed(ExtractLanguageModel)(extractLlm),
	Layer.succeed(WriterLanguageModel)(writerLlm),
)

const eventSinkLayer = Layer.succeed(ResearchEventSink)(
	ResearchEventSink.of({ fire: () => Effect.void }),
)

const ResearchLive = ResearchService.layer.pipe(
	Layer.provide(llmLayer),
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
	Layer.provide(eventSinkLayer),
	Layer.provideMerge(PgLive),
)

const systemDefaults: SystemDefaults = {
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	hardCeiling: 5000,
}

// The company's own domain rides the query text (the shape the repro used), not a
// structured field — the loop must still fetch it.
const researchInput: CreateResearchInput = {
	query: `Acme Anchor Logistics, ${ANCHOR_HOST}`,
	schemaName: 'company_enrichment_v1',
	// Skip the outer research_cache lookup so a fresh fiber always runs.
	forceFresh: true,
}

const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

const ctx = {} as { org: Org }
let userId = ''
let runId: string | null = null

beforeAll(async () => {
	const seed = await Effect.runPromise(
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
			// Seed the global sources row the run links the anchor fetch to by
			// url_hash — it stands in for the row the scrape cache would upsert in
			// production (the stub ScrapeProvider here does no caching).
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (
					${randomUUID()}, 'web', 'it-stub', ${ANCHOR_CANONICAL}, ${ANCHOR_URL_HASH},
					${ANCHOR_HOST}, ${createHash('sha256').update(ANCHOR_MARKDOWN).digest('hex')}
				)
				ON CONFLICT (url_hash) DO NOTHING
			`
			return { org, userId: user.id }
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			{ org: Org; userId: string },
			never,
			never
		>,
	)
	ctx.org = seed.org
	userId = seed.userId
}, 60_000)

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			if (runId) {
				// research_cache has no cascade from research_runs; delete it first.
				yield* sql`DELETE FROM research_cache WHERE research_id = ${runId}::uuid`
				yield* sql`DELETE FROM research_runs WHERE id = ${runId}::uuid`
			}
			yield* sql`DELETE FROM sources WHERE url_hash = ${ANCHOR_URL_HASH}`
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService anchor seed', () => {
	describe('when the caller gives the domain but the model gathers nothing', () => {
		it('should ground the run on the official site the fiber fetched up front', async () => {
			// GIVEN a company_enrichment run whose query carries the official domain,
			//   an Agent tier that gathers nothing itself (an empty web_search then a
			//   final answer), and a scrape provider that serves only that one site
			// WHEN the dispatch consumer drives the run to a terminal state
			// THEN the run succeeds — grounded on the anchor page the fiber fetched,
			//   not the model's own (empty) searching — with a strong entity match and
			//   that page linked as a source
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const sql = yield* SqlClient.SqlClient

					const created = yield* enterOrgScope(sql, {
						org: ctx.org,
						userId,
					})(svc.create(userId, ctx.org.id, researchInput, systemDefaults))
					runId = created.id

					const poll = (
						attemptsLeft: number,
					): Effect.Effect<
						{ status: string; errorMessage: string | null },
						never,
						never
					> =>
						Effect.gen(function* () {
							const run = (yield* svc.get(created.id).pipe(Effect.orDie)) as {
								status?: string
								errorMessage?: string | null
							} | null
							const status = run?.status ?? 'unknown'
							if (TERMINAL.has(status) || attemptsLeft <= 0) {
								return { status, errorMessage: run?.errorMessage ?? null }
							}
							yield* Effect.sleep('300 millis')
							return yield* poll(attemptsLeft - 1)
						})

					const final = yield* poll(50)

					const [sourceRow] = yield* sql<{ n: number }>`
						SELECT COUNT(*)::int AS n FROM research_run_sources
						WHERE research_id = ${created.id}::uuid
							AND source_id IN (
								SELECT id FROM sources WHERE url_hash = ${ANCHOR_URL_HASH}
							)
					`.pipe(Effect.orDie)

					const [entityRow] = yield* sql<{ entityMatch: string | null }>`
						SELECT entity_match AS "entityMatch"
						FROM research_runs WHERE id = ${created.id}::uuid
					`.pipe(Effect.orDie)

					return {
						status: final.status,
						errorMessage: final.errorMessage,
						anchorSourceCount: sourceRow?.n ?? 0,
						entityMatch: entityRow?.entityMatch ?? null,
					}
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					{
						status: string
						errorMessage: string | null
						anchorSourceCount: number
						entityMatch: string | null
					},
					never,
					never
				>,
			)

			expect(
				outcome.status,
				`run not succeeded: ${outcome.errorMessage ?? '(no error recorded)'}`,
			).toBe('succeeded')
			// The anchor site was fetched and linked, even though the model never did.
			expect(outcome.anchorSourceCount).toBeGreaterThanOrEqual(1)
			// Grounding is strong on the official page alone.
			expect(outcome.entityMatch).toBe('strong')
		})
	})
})
