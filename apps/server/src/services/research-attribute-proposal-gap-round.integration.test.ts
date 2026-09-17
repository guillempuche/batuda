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

import type { ResearchAttributeDeclaration } from '@batuda/domain'
import {
	AgentLanguageModel,
	ContactDiscovery,
	ExtractLanguageModel,
	MapProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	type ResolvedInstructions,
	type ScrapedPage,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// A run about a company on file reads a declared attribute only in a gap round:
// the first reading of the pages keeps none, and the second look the round buys
// is what finds it. The proposal that carries attribute-only news has to be made
// after that round folds its reading in — made earlier, inside the chain that
// grades one reading, the fold keeps the base run's proposal list and the
// proposal is lost, so a value nobody can apply never lands on the company.
//
// Both cases below drive the real fiber against Postgres, with every model and
// every provider stubbed, and read the run back the way the apply path lists it.

// A host of its own per suite run, so the seeded page cannot collide with
// another run's.
const ANCHOR_HOST = `casalprim-${randomUUID()}.example`
const ANCHOR_URL = `https://${ANCHOR_HOST}`
// canonicalizeUrl() runs the URL through `new URL().toString()`, which appends a
// trailing slash to a bare host — so the run links its source by this hash.
const ANCHOR_CANONICAL = new URL(ANCHOR_URL).toString()
const ANCHOR_URL_HASH = createHash('sha256')
	.update(ANCHOR_CANONICAL)
	.digest('hex')
const COMPANY_NAME = 'Casalprim Freight Partners'
// The page says, in its own words, both where the company is and that the
// family runs it. A value is kept only when the words quoted for it are on the
// page run for run, so every quote below is lifted straight out of this.
const ANCHOR_MARKDOWN = `${COMPANY_NAME} — transitaris amb seu a Barcelona. Som una empresa familiar des de 1998.`
const LOCATION_QUOTE = 'amb seu a Barcelona'
const FAMILY_QUOTE = 'Som una empresa familiar'

// The reason packages/research stamps on the proposal it adds for attributes —
// written out here rather than imported, so a change to the wording fails this
// test instead of passing quietly.
const ATTRIBUTE_PROPOSAL_REASON =
	'Attribute values read from the pages, for the company on file.'

const FAMILY_OWNED: ResearchAttributeDeclaration = {
	key: 'family_owned',
	label: 'Family owned',
	kind: 'boolean',
	enumValues: null,
	unit: null,
	description: 'Whether the family that founded the business still runs it.',
}

interface Org {
	id: string
	name: string
	slug: string
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

const settled = {
	text: '',
	content: [],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
	usage,
}

// Whether this run's reading may answer with the attribute before a gap round
// has bought anything. False is the bug's own shape: the value exists only in
// the second look.
let attributeReadUpFront = false
// Flipped by the search provider, which on a company profile is only ever
// reached from inside a gap round — the searching pass here hands its own
// results back and never calls out. So this says "a gap round has started
// buying", which is what decides whether a reading has the value to give.
let gapRoundSearched = false
// How many readings of the pages were asked for, so a case can say the first
// one was answered without the attribute.
let extractions = 0
// The attribute map each reading answered with, in order.
const attributesOffered: Array<Record<string, unknown> | null> = []

const attributeEntry = {
	value: true,
	source_id: ANCHOR_CANONICAL,
	quote: FAMILY_QUOTE,
	confidence: 1,
}

// The searching pass gathers the company's own page and settles at once, so the
// run reaches the reading with evidence and spends nothing on the way.
const agentLlm: LanguageModel.Service = {
	generateText: () =>
		Effect.succeed({
			...settled,
			toolResults: [
				{
					name: 'web_search',
					isFailure: false,
					encodedResult: undefined,
					result: { items: [{ url: ANCHOR_URL, content: ANCHOR_MARKDOWN }] },
				},
			],
		}) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const hasField = (schema: unknown, name: string): boolean => {
	const fields = (schema as { fields?: Record<string, unknown> } | undefined)
		?.fields
	return fields !== undefined && Object.hasOwn(fields, name)
}

const extractLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed(settled) as never,
	generateObject: ((options: { readonly schema?: unknown }) =>
		Effect.sync(() => {
			const schema = options.schema
			// The critic asks this same model to rule on the fields a reading kept;
			// an empty list of verdicts keeps every one, the way a judge with
			// nothing to say does.
			if (hasField(schema, 'verdicts'))
				return { usage, value: { verdicts: [] } }
			// The focused contacts pass asks with a shape of its own, and finds
			// nobody here.
			if (!hasField(schema, 'enrichment'))
				return { usage, value: { contacts: [] } }
			extractions++
			const attributes =
				attributeReadUpFront || gapRoundSearched
					? { family_owned: attributeEntry }
					: null
			attributesOffered.push(attributes)
			return {
				usage,
				value: {
					summary: `${COMPANY_NAME} is a Barcelona freight forwarder.`,
					enrichment: {
						location: {
							value: 'Barcelona',
							source_id: ANCHOR_CANONICAL,
							quote: LOCATION_QUOTE,
							confidence: 1,
						},
					},
					contacts: [],
					...(attributes === null ? {} : { attributes }),
				},
			}
		})) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const writerLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed({ ...settled, text: '## Brief' }) as never,
	generateObject: () => Effect.succeed({ usage, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const unused = 'research provider not exercised by this test'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({
			// A gap round's focused search. It buys nothing new — the company's own
			// page is already in hand — but firing at all is what says a round ran,
			// and it is what lets the reading after it answer with the attribute.
			search: () =>
				Effect.sync(() => {
					gapRoundSearched = true
					return {
						items: [
							{
								url: ANCHOR_URL,
								title: COMPANY_NAME,
								snippet: FAMILY_QUOTE,
								content: ANCHOR_MARKDOWN,
							},
						],
						units: 1,
					}
				}) as never,
		}),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({
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

const runtime = ManagedRuntime.make(ResearchLive)

const systemDefaults = {
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	hardCeiling: 5000,
}

const instructions: ResolvedInstructions = {
	segments: [],
	fingerprint: '',
	templateIds: [],
	templateNames: [],
	attributes: [FAMILY_OWNED],
	attributeFingerprint: 'fp-family-owned',
}

const TERMINAL = new Set([
	'succeeded',
	'succeeded_low_confidence',
	'failed',
	'cancelled',
	'no_reliable_data',
])

interface StoredProposal {
	readonly id?: string
	readonly status?: string
	readonly subject_table?: string
	readonly subject_id?: string
	readonly operation?: string
	readonly fields?: unknown
	readonly reason?: string
}

const ctx = {} as { org: Org }
let userId = ''
let companyId = ''
const runIds: string[] = []

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
			const [company] = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${org.id}, ${`casalprim-${randomUUID()}`}, ${COMPANY_NAME})
				RETURNING id
			`
			yield* sql`
				INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
				VALUES (
					${randomUUID()}, 'web', 'it-stub', ${ANCHOR_CANONICAL}, ${ANCHOR_URL_HASH},
					${ANCHOR_HOST}, ${createHash('sha256').update(ANCHOR_MARKDOWN).digest('hex')}
				)
				ON CONFLICT (url_hash) DO NOTHING
			`
			return { org, userId: user.id, companyId: company?.id ?? '' }
		}).pipe(Effect.orDie),
	)
	ctx.org = seed.org
	userId = seed.userId
	companyId = seed.companyId
}, 60_000)

afterAll(async () => {
	await runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const id of runIds) {
				yield* sql`DELETE FROM research_links WHERE research_id = ${id}::uuid`
				yield* sql`DELETE FROM research_run_sources WHERE research_id = ${id}::uuid`
				yield* sql`DELETE FROM research_cache WHERE research_id = ${id}::uuid`
				yield* sql`DELETE FROM research_runs WHERE id = ${id}::uuid`
			}
			// Anything hanging off the company row (its timeline, above all) is
			// carried away with it by the foreign keys.
			yield* sql`DELETE FROM companies WHERE id = ${companyId}::uuid`
			yield* sql`DELETE FROM sources WHERE url_hash = ${ANCHOR_URL_HASH}`
		}).pipe(Effect.orDie),
	)
	await runtime.dispose()
}, 60_000)

// One run about the company on file, driven to its end, read back both off the
// row and through the service the apply path lists proposals from.
const runOnTheCompany = async (attributeUpFront = false) => {
	attributeReadUpFront = attributeUpFront
	gapRoundSearched = false
	extractions = 0
	attributesOffered.length = 0
	return runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const sql = yield* SqlClient.SqlClient
			const created = yield* enterOrgScope(sql, { org: ctx.org, userId })(
				svc.create(
					userId,
					ctx.org.id,
					{
						query: `${COMPANY_NAME}, ${ANCHOR_HOST}`,
						schemaName: 'company_enrichment_v1',
						forceFresh: true,
						context: {
							subjects: [{ table: 'companies' as const, id: companyId }],
						},
					},
					systemDefaults,
					instructions,
				),
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
					yield* Effect.sleep('250 millis')
					return yield* poll(attemptsLeft - 1)
				})
			const status = yield* poll(160)

			const [row] = yield* sql<{ findings: unknown; toolLog: unknown }>`
				SELECT findings, tool_log AS "toolLog"
				FROM research_runs WHERE id = ${created.id}::uuid
			`
			// The same read list_research_proposed_updates makes: the run through
			// the service, then its findings' proposal list.
			const asRead = (yield* enterOrgScope(sql, { org: ctx.org, userId })(
				svc.get(created.id),
			).pipe(Effect.orDie)) as {
				findings?: { proposed_updates?: ReadonlyArray<StoredProposal> }
			} | null
			const toolLog = Array.isArray(row?.toolLog)
				? (row.toolLog as ReadonlyArray<{ tool?: string; type?: string }>)
				: []
			return {
				status,
				storedFindings: (row?.findings ?? {}) as Record<string, unknown>,
				listedProposals: asRead?.findings?.proposed_updates ?? [],
				gapRounds: toolLog.filter(
					entry =>
						entry.tool === 'research.gap_round' && entry.type === 'result',
				).length,
			}
		}).pipe(Effect.orDie),
	)
}

const proposalsOnTheCompany = (proposals: ReadonlyArray<StoredProposal>) =>
	proposals.filter(
		proposal =>
			proposal.subject_table === 'companies' &&
			proposal.subject_id === companyId,
	)

describe('a run about a company on file, when a declared attribute is only read in a gap round', () => {
	it('should keep the value and hand a person one pending proposal to apply it with', async () => {
		// GIVEN a run anchored on the company, whose first reading of the pages
		// answers with enrichment and no attribute at all, and whose reading after
		// the gap round's search answers with the family_owned value, quoted in the
		// page's own words

		// WHEN the run goes through
		const { status, storedFindings, listedProposals, gapRounds } =
			await runOnTheCompany()

		// THEN a gap round really ran, the first reading gave nothing for the
		// attribute, and the value that round brought in is what the run stores
		expect(status).not.toBe('failed')
		expect(TERMINAL.has(status)).toBe(true)
		expect(gapRounds).toBeGreaterThanOrEqual(1)
		expect(extractions).toBeGreaterThanOrEqual(2)
		expect(attributesOffered[0]).toBeNull()
		expect(storedFindings['attributes']).toMatchObject({
			family_owned: { value: true, quote: FAMILY_QUOTE },
		})

		// AND the run hands back exactly one pending update on the company, with
		// no fields of its own, for the apply path to fill from those values
		const proposals = proposalsOnTheCompany(listedProposals)
		expect(proposals).toHaveLength(1)
		expect(proposals[0]).toMatchObject({
			status: 'pending',
			operation: 'update',
			fields: {},
			reason: ATTRIBUTE_PROPOSAL_REASON,
		})
		expect(typeof proposals[0]?.id).toBe('string')
	}, 120_000)

	it('should still hand back one proposal when the first reading already had the value', async () => {
		// GIVEN the same run, with the attribute answered from the very first
		// reading, so the gap round's reading only repeats it

		// WHEN the run goes through
		const { status, storedFindings, listedProposals } =
			await runOnTheCompany(true)

		// THEN the value is stored once and there is one proposal, not one per
		// reading of the pages
		expect(TERMINAL.has(status)).toBe(true)
		expect(storedFindings['attributes']).toMatchObject({
			family_owned: { value: true, quote: FAMILY_QUOTE },
		})
		expect(proposalsOnTheCompany(listedProposals)).toHaveLength(1)
	}, 120_000)
})
