// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'

import { createHash, randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	type CreateResearchInput,
	ExtractLanguageModel,
	MapProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	type SystemDefaults,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// The entity grounding gate end to end: an enrichment run whose fetched evidence
// is about a DIFFERENT company must fail closed to no_reliable_data; one that
// clearly names the target must still succeed; a run that only glancingly
// mentions it (a weak match) must also fail closed to no_reliable_data rather than
// present a lookalike's profile; and a run whose only scrape FAILS must resolve to
// no_reliable_data, not failed.
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
	readonly query: string
	readonly schemaName: string
	readonly url: string
	readonly markdown: string
	readonly isFailure: boolean
}

let scenario: Scenario
let agentCall = 0

const usage = {
	inputTokens: {
		uncached: undefined,
		total: 0,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 0, text: undefined, reasoning: undefined },
}

const finalRound = {
	text: 'done',
	content: [{ type: 'text' as const, text: 'done' }],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
	usage,
}

// Round 1 scrapes one page; a failing scrape carries an AiError-shaped result the
// toolkit surfaces with isFailure: true, exactly as failureMode: 'return' does.
const scrapeRound = () => ({
	text: '',
	content: [{ type: 'text' as const, text: 'scraping' }],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [{ id: 's1', name: 'scrape_page', params: { url: scenario.url } }],
	toolResults: [
		{
			id: 's1',
			name: 'scrape_page',
			result: scenario.isFailure
				? {
						_tag: 'UnknownError',
						description: 'scrape_page: scrape failed: HTTP 401',
					}
				: { url: scenario.url, markdown: scenario.markdown },
			encodedResult: undefined,
			isFailure: scenario.isFailure,
		},
	],
	finishReason: 'tool-calls' as const,
	usage,
})

const agentLlm: LanguageModel.Service = {
	generateText: (_o: unknown) =>
		Effect.sync(() =>
			agentCall++ === 0 ? scrapeRound() : finalRound,
		) as never,
	generateObject: (_o: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_o: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// The extractor proposes creating one contact citing the scraped page. Its only
// field is a name (no email/phone), so the value guard cannot strip it — whether
// it survives to the findings is decided by the entity gate alone.
const extractLlm: LanguageModel.Service = {
	generateText: (_o: unknown) => Effect.succeed(finalRound) as never,
	generateObject: (_o: unknown) =>
		Effect.succeed({
			...finalRound,
			value: {
				enrichment: {
					industry: 'Freight',
					citations: [{ source_id: scenario.url }],
				},
				proposed_updates: [
					{
						subject_table: 'contacts',
						operation: 'create',
						fields: { name: 'Jane Doe' },
						reason: 'discovered on the about page',
						citations: [{ source_id: scenario.url }],
					},
				],
			},
		}) as never,
	streamText: (_o: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: (_o: unknown) =>
		Effect.succeed({ ...finalRound, text: 'a brief' }) as never,
	generateObject: (_o: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_o: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const unused = 'research provider not exercised by the Agent stub'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
	),
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
	Layer.provide(
		Layer.succeed(ResearchEventSink)(
			ResearchEventSink.of({ fire: () => Effect.void }),
		),
	),
	Layer.provideMerge(PgLive),
)

// Build the whole research stack once and reuse it across every case: a single
// dispatcher + connection pool serves the file. Building it per case would start a
// fresh dispatcher + pool each time and exhaust the CI database's connection cap.
const runtime = ManagedRuntime.make(ResearchLive)

const systemDefaults: SystemDefaults = {
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	hardCeiling: 5000,
}

const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

const ctx = {} as { org: Org }
let userId = ''
const createdRunIds: string[] = []

// A source row per scraped URL, standing in for the row the scrape cache would
// upsert in production, so the loop can link research_run_sources by url_hash.
const seedSource = (url: string, markdown: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (
					${randomUUID()}, 'web', 'it-stub', ${url},
					${createHash('sha256').update(url).digest('hex')},
					${new URL(url).hostname},
					${createHash('sha256').update(markdown).digest('hex')}
				)
				ON CONFLICT (url_hash) DO NOTHING
			`
		}),
	)

interface RunResult {
	readonly status: string
	readonly errorMessage: string | null
	readonly sourceCount: number
	readonly findings: {
		proposedUpdates?: unknown[]
	} | null
}

const runScenario = async (next: Scenario): Promise<RunResult> => {
	scenario = next
	agentCall = 0
	if (!next.isFailure) await seedSource(next.url, next.markdown)

	const input: CreateResearchInput = {
		query: next.query,
		schemaName: next.schemaName,
		forceFresh: true,
	}

	return runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const sql = yield* SqlClient.SqlClient

			const created = yield* enterOrgScope(sql, { org: ctx.org, userId })(
				svc.create(userId, ctx.org.id, input, systemDefaults),
			)
			// A non-selector input never fans out, so it always carries a run id;
			// rule out the confirm-required variant to keep the type honest.
			if (created.status === 'confirm_required')
				return yield* Effect.die(
					new Error('entity-gate test input should not fan out'),
				)
			createdRunIds.push(created.id)

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

			const [sourceCount] = yield* sql<{ n: number }>`
				SELECT COUNT(*)::int AS n FROM research_run_sources
				WHERE research_id = ${created.id}::uuid
			`.pipe(Effect.orDie)

			const [row] = yield* sql<{ findings: RunResult['findings'] }>`
				SELECT findings FROM research_runs WHERE id = ${created.id}::uuid
			`.pipe(Effect.orDie)

			return {
				status: final.status,
				errorMessage: final.errorMessage,
				sourceCount: sourceCount?.n ?? 0,
				findings: row?.findings ?? null,
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
			yield* sql`DELETE FROM sources WHERE provider = 'it-stub'`
		}),
	)
	await runtime.dispose()
})

describe('ResearchService entity grounding gate', () => {
	describe('when the fetched evidence is about a different company', () => {
		it('should fail closed to no_reliable_data instead of reporting the wrong data', async () => {
			// GIVEN an enrichment run for a company that does not exist, whose only
			//   scrape returns a page about an unrelated freight broker
			const result = await runScenario({
				query: 'Zxqvon Interstellar Freight Brokerage LLC',
				schemaName: 'company_enrichment_v1',
				url: `https://absent-${randomUUID()}.example/about`,
				markdown: 'Topia Freight is a load broker based in Denver, Colorado.',
				isFailure: false,
			})

			// THEN it fails closed — the evidence never named the target
			expect(
				result.status,
				`unexpected status: ${result.errorMessage ?? '(none)'}`,
			).toBe('no_reliable_data')
		}, 30_000)
	})

	describe('when the fetched evidence clearly names the target', () => {
		it('should succeed and keep its create proposal intact', async () => {
			// GIVEN an enrichment run whose scrape names the target company in full
			const result = await runScenario({
				query: 'Acme Logistics',
				schemaName: 'company_enrichment_v1',
				url: `https://acme-${randomUUID()}.example/about`,
				markdown:
					'Acme Logistics S.L. is a freight forwarder based in Barcelona.',
				isFailure: false,
			})

			// THEN it succeeds with its create proposal intact
			expect(
				result.status,
				`unexpected status: ${result.errorMessage ?? '(none)'}`,
			).toBe('succeeded')
			expect(result.findings?.proposedUpdates).toHaveLength(1)
		}, 30_000)
	})

	describe('when the fetched evidence only glancingly mentions the target', () => {
		it('should fail closed to no_reliable_data instead of presenting a lookalike', async () => {
			// GIVEN an enrichment run whose scrape mentions the brand word but never
			//   the full name or the company's own site (a weak match)
			const result = await runScenario({
				query: 'Acme Logistics',
				schemaName: 'company_enrichment_v1',
				url: `https://dir-${randomUUID()}.example/listing`,
				markdown: 'A directory lists Acme among many freight brokers.',
				isFailure: false,
			})

			// THEN it fails closed — the evidence never clearly named the target, so no
			//   lookalike profile is extracted or presented
			expect(
				result.status,
				`unexpected status: ${result.errorMessage ?? '(none)'}`,
			).toBe('no_reliable_data')
		}, 30_000)
	})

	describe('when the only scrape fails', () => {
		it('should continue past the failed fetch and end no_reliable_data, not failed', async () => {
			// GIVEN a run whose single scrape_page call returns a provider failure
			//   (surfaced to the model, not fatal), leaving no page fetched
			const result = await runScenario({
				query: 'anything at all',
				schemaName: 'freeform',
				url: `https://dead-${randomUUID()}.example/x`,
				markdown: '',
				isFailure: true,
			})

			// THEN the failed fetch did not crash the run; it fell through to the
			//   grounding gate with zero sources
			expect(
				result.status,
				`unexpected status: ${result.errorMessage ?? '(none)'}`,
			).toBe('no_reliable_data')
			expect(result.sourceCount).toBe(0)
		}, 30_000)
	})
})
