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

import type { ResearchAttributeDeclaration } from '@batuda/domain'
import {
	AgentLanguageModel,
	ContactDiscovery,
	type CreateResearchInput,
	ExtractLanguageModel,
	MapProvider,
	ProviderError,
	RESPONSE_CUT_OFF,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	type ResolvedInstructions,
	type ScrapedPage,
	ScrapeProvider,
	SearchProvider,
	type SystemDefaults,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// The attributes a run is asked for travel with it: written on its row when it
// is created, read back off the row when it runs. Every model is a stub that
// gathers nothing, so what is checked is the plumbing — the columns, and a run
// that carries declarations reaching the end — not what a model would write.
// One case anchors the run on a seeded page so extraction runs at all, and has
// the extraction model cut its first reply off, to see the run ask once more.

// A domain unique per run so the seeded sources row cannot collide across runs.
const ANCHOR_HOST = `acme-attributes-${randomUUID()}.example`
const ANCHOR_URL = `https://${ANCHOR_HOST}`
// canonicalizeUrl() runs the URL through `new URL().toString()`, which appends a
// trailing slash to a bare host — so the run links its source by this hash.
const ANCHOR_CANONICAL = new URL(ANCHOR_URL).toString()
const ANCHOR_URL_HASH = createHash('sha256')
	.update(ANCHOR_CANONICAL)
	.digest('hex')
const ANCHOR_MARKDOWN =
	'Acme Attributes Logistics — freight forwarding based in Barcelona.'

interface Org {
	id: string
	name: string
	slug: string
}

const SITES: ResearchAttributeDeclaration = {
	key: 'site_count',
	label: 'Sites',
	kind: 'number',
	enumValues: null,
	unit: 'sites',
	description: 'How many premises the business trades from.',
}

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
	text: 'Could not find much on the open web.',
	content: [
		{ type: 'text' as const, text: 'Could not find much on the open web.' },
	],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
	usage,
}

// Every prompt the run builds is kept, so the test can say which ones named the
// attributes and which did not.
const prompts: string[] = []
const remember = (options: unknown) => {
	prompts.push(JSON.stringify(options))
}

const agentLlm: LanguageModel.Service = {
	generateText: (options: unknown) => {
		remember(options)
		return Effect.succeed(finalRound) as never
	},
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// When set, the next extraction reply is cut off mid-answer, the way a vendor
// cuts one at the ceiling, and the flag clears so the retry is answered.
let cutOffNextExtraction = false

const extractLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.succeed(finalRound) as never,
	generateObject: (options: unknown) => {
		remember(options)
		if (cutOffNextExtraction) {
			cutOffNextExtraction = false
			return Effect.fail(
				new ProviderError({
					provider: 'stub',
					message: 'reply cut off',
					recoverable: false,
					reason: RESPONSE_CUT_OFF,
				}),
			) as never
		}
		return Effect.succeed({
			...finalRound,
			value: {
				summary: 'Acme Attributes Logistics is a Barcelona freight forwarder.',
			},
		}) as never
	},
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: (options: unknown) => {
		remember(options)
		return Effect.succeed({
			...finalRound,
			text: 'Nothing was found.',
		}) as never
	},
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const unused = 'research provider not exercised by this test'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({
			// The anchor host serves its page; the model fetches nothing else.
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

const systemDefaults: SystemDefaults = {
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	hardCeiling: 5000,
}

const instructionsWith = (
	attributes: ReadonlyArray<ResearchAttributeDeclaration>,
): ResolvedInstructions => ({
	segments: [],
	fingerprint: '',
	templateIds: [],
	templateNames: [],
	attributes,
	attributeFingerprint: attributes.length === 0 ? '' : `fp-${randomUUID()}`,
})

const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

const ctx = {} as { org: Org }
let userId = ''
const runIds: string[] = []

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
			for (const id of runIds) {
				yield* sql`DELETE FROM research_cache WHERE research_id = ${id}::uuid`
				yield* sql`DELETE FROM research_runs WHERE id = ${id}::uuid`
			}
			yield* sql`DELETE FROM sources WHERE url_hash = ${ANCHOR_URL_HASH}`
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

// Creates a run with the given resolved instructions, waits for it to end, and
// reads back what its row says it was asked for. A query naming the anchor host
// makes the run fetch that page up front, which is what gets it to extraction.
const runWith = (
	instructions: ResolvedInstructions,
	query = `Acme attributes ${randomUUID()}`,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const sql = yield* SqlClient.SqlClient
			const input: CreateResearchInput = {
				query,
				schemaName: 'company_enrichment_v1',
				forceFresh: true,
			}
			const created = yield* enterOrgScope(sql, { org: ctx.org, userId })(
				svc.create(userId, ctx.org.id, input, systemDefaults, instructions),
			)
			if (created.status === 'confirm_required')
				return yield* Effect.die(new Error('the input should not fan out'))
			runIds.push(created.id)

			const poll = (
				attemptsLeft: number,
			): Effect.Effect<string, never, never> =>
				Effect.gen(function* () {
					const run = (yield* svc.get(created.id).pipe(Effect.orDie)) as {
						status?: string
					} | null
					const status = run?.status ?? 'unknown'
					if (TERMINAL.has(status) || attemptsLeft <= 0) return status
					yield* Effect.sleep('300 millis')
					return yield* poll(attemptsLeft - 1)
				})
			const status = yield* poll(50)

			const [row] = yield* sql<{
				attributeFingerprint: string | null
				attributeDeclarations: unknown
			}>`
				SELECT attribute_fingerprint AS "attributeFingerprint",
					attribute_declarations AS "attributeDeclarations"
				FROM research_runs WHERE id = ${created.id}::uuid
			`.pipe(Effect.orDie)
			return { status, row }
		}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
			{
				status: string
				row:
					| {
							attributeFingerprint: string | null
							attributeDeclarations: unknown
					  }
					| undefined
			},
			never,
			never
		>,
	)

describe('ResearchService, the attributes a run is asked for', () => {
	describe('when a run is created with resolved attributes', () => {
		it('should write them on its row, ask the searching pass for them, and run to the end', async () => {
			// GIVEN instructions resolved with one declaration
			const instructions = instructionsWith([SITES])
			prompts.length = 0

			// WHEN the run is created and runs on stubbed models
			const { status, row } = await runWith(instructions)

			// THEN the row carries the declaration and its fingerprint
			expect(row?.attributeFingerprint).toBe(instructions.attributeFingerprint)
			expect(row?.attributeDeclarations).toEqual([SITES])
			// AND the run reached an end, the searching pass having been told what
			// the attribute means — the extraction pass is pinned by its own unit
			// tests, since a run that gathers nothing never reaches it
			expect(TERMINAL.has(status)).toBe(true)
			expect(
				prompts.some(p => p.includes('--- attribute site_count ---')),
			).toBe(true)
		}, 60_000)
	})

	describe('when a run is created with no attributes', () => {
		it('should write an empty list and no fingerprint, and ask for none', async () => {
			// GIVEN instructions with nothing declared
			prompts.length = 0

			// WHEN the run is created and runs
			const { status, row } = await runWith(instructionsWith([]))

			// THEN the row says so and no prompt mentions attributes
			expect(row?.attributeFingerprint).toBe('')
			expect(row?.attributeDeclarations).toEqual([])
			expect(TERMINAL.has(status)).toBe(true)
			expect(prompts.some(p => p.includes('--- attribute '))).toBe(false)
		}, 60_000)
	})

	describe('when the extraction reply is cut off mid-answer', () => {
		it('should ask once more, shorter, and carry on', async () => {
			// GIVEN a run anchored on a page the fiber fetches, whose first
			// extraction reply is cut off
			cutOffNextExtraction = true
			prompts.length = 0

			// WHEN the run goes through
			const { status } = await runWith(
				instructionsWith([SITES]),
				`Acme Attributes Logistics, ${ANCHOR_HOST}`,
			)

			// THEN the extraction was asked twice, the second time told to write
			// less, and the run still ended
			const extractions = prompts.filter(p =>
				p.includes('Produce structured findings'),
			)
			expect(extractions.length).toBeGreaterThanOrEqual(2)
			expect(extractions[0]).not.toContain('ran past the length')
			expect(extractions[1]).toContain('ran past the length')
			expect(cutOffNextExtraction).toBe(false)
			expect(TERMINAL.has(status)).toBe(true)
		}, 60_000)
	})
})
