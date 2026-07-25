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

// The success path of the whole engine: an Agent tier that actually scrapes a
// page drives the run to 'succeeded' (the grounding gate passes on the linked
// source), and the extractor's fabricated proposal is stripped by the value
// guard while the grounded one survives. The dispatch suite proves the mirror
// case — a run that scrapes nothing fails closed to no_reliable_data.
//
// The Agent stub returns a scrape_page tool RESULT directly (it does not call
// the real ScrapeProvider), so the loop links research_run_sources by url_hash
// to a sources row this suite seeds. The URL is already canonical, so its
// url_hash is a plain sha256 — the same value urlHashForScrape() computes.

interface Org {
	id: string
	name: string
	slug: string
}

const SCRAPED_URL = `https://acme-${randomUUID()}.example/about`
const SCRAPED_HOST = new URL(SCRAPED_URL).hostname
const URL_HASH = createHash('sha256').update(SCRAPED_URL).digest('hex')
const SOURCE_ID = randomUUID()

// Set in beforeAll: a real contact the grounded proposal targets, and its
// company, so the applicability guard keeps that proposal and cleanup cascades.
let realContactId = ''
let seededCompanyId = ''

// The scraped markdown carries the real phone the grounded proposal cites, so
// the value guard finds it in the evidence and keeps that proposal.
const SCRAPE_MARKDOWN =
	'Acme Logistics S.L. — freight forwarding based in Barcelona. ' +
	'Contact: Tel 936 123 456.'

const usage = {
	inputTokens: {
		uncached: undefined,
		total: 0,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 0, text: undefined, reasoning: undefined },
}

// Round 1: the model scrapes the about page (a tool call plus its result).
const scrapeRound = {
	text: '',
	content: [
		{ type: 'text' as const, text: 'Scraping the company about page.' },
	],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [{ id: 's1', name: 'scrape_page', params: { url: SCRAPED_URL } }],
	toolResults: [
		{
			id: 's1',
			name: 'scrape_page',
			result: { url: SCRAPED_URL, markdown: SCRAPE_MARKDOWN },
			encodedResult: undefined,
			isFailure: false,
		},
	],
	finishReason: 'tool-calls' as const,
	usage,
}

// Round 2: no tool calls, so the loop stops and the run advances to phase 2.
const finalRound = {
	...scrapeRound,
	text: 'Acme Logistics is a Barcelona freight forwarder.',
	content: [
		{
			type: 'text' as const,
			text: 'Acme Logistics is a Barcelona freight forwarder.',
		},
	],
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
}

let agentCall = 0
const agentLlm: LanguageModel.Service = {
	generateText: (_options: unknown) =>
		Effect.sync(() => (agentCall++ === 0 ? scrapeRound : finalRound)) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// The extractor emits two proposed CRM writes citing the scraped page: one phone
// that appears in the markdown (grounded) and one invented (the prod-bug shape).
const extractLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.succeed(finalRound) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({
			...finalRound,
			value: {
				summary: 'Acme Logistics is a Barcelona freight forwarder.',
				proposed_updates: [
					{
						subject_table: 'contacts',
						subject_id: realContactId,
						operation: 'update',
						expected_version: 0,
						fields: { phone: '936 123 456' },
						reason: 'from about page',
						citations: [{ source_id: SCRAPED_URL }],
					},
					{
						subject_table: 'contacts',
						subject_id: 'c-fake',
						operation: 'update',
						expected_version: 0,
						fields: { phone: '(404) 555-0198' },
						reason: 'invented',
						citations: [{ source_id: SCRAPED_URL }],
					},
				],
			},
		}) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: (_options: unknown) =>
		Effect.succeed({
			...finalRound,
			text: 'Acme Logistics is a Barcelona freight forwarder. Tel 936 123 456.',
		}) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// The real providers are never called: the Agent stub returns the scrape result
// itself. Dying makes any accidental invocation fail loudly.
const unused = 'research provider not exercised by the Agent stub'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
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

const researchInput: CreateResearchInput = {
	query: 'Acme Logistics grounding test',
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
			// Seed the global sources row the loop links to by url_hash — it stands
			// in for the row the scrape cache would have upserted in production.
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (
					${SOURCE_ID}, 'web', 'it-stub', ${SCRAPED_URL}, ${URL_HASH},
					${SCRAPED_HOST}, ${createHash('sha256').update(SCRAPE_MARKDOWN).digest('hex')}
				)
				ON CONFLICT (url_hash) DO NOTHING
			`
			// A real contact the grounded proposal updates, so the applicability
			// guard keeps it — a proposal targeting a row that does not exist is
			// dropped as un-appliable.
			const [company] = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${org.id}, ${`grounding-${randomUUID()}`}, 'Acme Logistics')
				RETURNING id
			`
			const [contact] = yield* sql<{ id: string }>`
				INSERT INTO contacts (organization_id, company_id, name)
				VALUES (${org.id}, ${company?.id ?? ''}, 'Grace Hopper')
				RETURNING id
			`
			return {
				org,
				userId: user.id,
				companyId: company?.id ?? '',
				contactId: contact?.id ?? '',
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			{ org: Org; userId: string; companyId: string; contactId: string },
			never,
			never
		>,
	)
	ctx.org = seed.org
	userId = seed.userId
	seededCompanyId = seed.companyId
	realContactId = seed.contactId
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
			yield* sql`DELETE FROM sources WHERE url_hash = ${URL_HASH}`
			if (seededCompanyId) {
				// Cascades the seeded contact.
				yield* sql`DELETE FROM companies WHERE id = ${seededCompanyId}::uuid`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService grounding', () => {
	describe('when the Agent tier scrapes a page and the extractor mixes real and invented values', () => {
		it('should succeed on the grounded source and drop only the fabricated proposal', async () => {
			// GIVEN a run whose Agent tier scrapes one page (linked to a seeded
			//   sources row) and whose extractor proposes one grounded phone and one
			//   invented phone, both citing the scraped URL
			// WHEN the dispatch consumer drives the run to a terminal state
			// THEN the run succeeds (the grounding gate passes on the linked source),
			//   research_run_sources is non-empty, and only the grounded proposal
			//   survives — the value guard drops the invented one
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const sql = yield* SqlClient.SqlClient

					const created = yield* enterOrgScope(sql, {
						org: ctx.org,
						userId,
					})(svc.create(userId, ctx.org.id, researchInput, systemDefaults))
					// A non-selector input never fans out, so it always carries a run
					// id; rule out the confirm-required variant to keep the type honest.
					if (created.status === 'confirm_required')
						return yield* Effect.die(
							new Error('grounding test input should not fan out'),
						)
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

					const [sourceCount] = yield* sql<{ n: number }>`
						SELECT COUNT(*)::int AS n FROM research_run_sources
						WHERE research_id = ${created.id}::uuid
					`.pipe(Effect.orDie)

					const [row] = yield* sql<{ findings: unknown }>`
						SELECT findings FROM research_runs WHERE id = ${created.id}::uuid
					`.pipe(Effect.orDie)

					return {
						status: final.status,
						errorMessage: final.errorMessage,
						sourceCount: sourceCount?.n ?? 0,
						findings: row?.findings ?? null,
					}
				}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
					{
						status: string
						errorMessage: string | null
						sourceCount: number
						findings: unknown
					},
					never,
					never
				>,
			)

			expect(
				outcome.status,
				`run not succeeded: ${outcome.errorMessage ?? '(no error recorded)'}`,
			).toBe('succeeded')
			expect(outcome.sourceCount).toBeGreaterThanOrEqual(1)

			const proposals = (
				outcome.findings as {
					proposed_updates?: Array<{ subject_id: string }>
				} | null
			)?.proposed_updates
			expect(proposals?.map(p => p.subject_id)).toEqual([realContactId])
		}, 30_000)
	})
})
