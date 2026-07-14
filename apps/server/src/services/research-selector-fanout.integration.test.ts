// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '4'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	type CreateResearchInput,
	ExtractLanguageModel,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	type SystemDefaults,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client'
import { enterOrgScope } from '../middleware/org'

// A selector run fans out into a group parent + one leaf per matching company.
// With a stub language model that emits no tool calls, nothing is scraped, so
// each leaf fails the grounding gate and ends no_reliable_data — which proves
// the parent still rolls up (to failed) even when no leaf succeeds, the gap the
// original success-only rollup left open.

interface Org {
	id: string
	name: string
	slug: string
}

const STUB_TEXT = 'Acme is a Barcelona company.'
const stubResponse = {
	text: STUB_TEXT,
	content: [{ type: 'text' as const, text: STUB_TEXT }],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
	usage: {
		inputTokens: {
			uncached: undefined,
			total: 0,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: 0, text: undefined, reasoning: undefined },
	},
}

const stubLlm: LanguageModel.Service = {
	generateText: () => Effect.succeed(stubResponse) as never,
	generateObject: () =>
		Effect.succeed({ ...stubResponse, value: { summary: STUB_TEXT } }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: STUB_TEXT }) as never,
}

const unused = 'provider not exercised by the stub'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
	),
)

const llmLayer = Layer.mergeAll(
	Layer.succeed(AgentLanguageModel)(stubLlm),
	Layer.succeed(ExtractLanguageModel)(stubLlm),
	Layer.succeed(WriterLanguageModel)(stubLlm),
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

const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

const TAG = `fanout-${randomUUID()}`
const EMPTY_TAG = `empty-${randomUUID()}`
const ctx = {} as { org: Org }
let userId = ''
const groupIds: string[] = []

const seedCompany = () =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			INSERT INTO companies (organization_id, slug, name, tags)
			VALUES (${ctx.org.id}, ${`fan-${randomUUID()}`}, 'Fan Co', ${[TAG]})
		`
	})

const createSelectorRun = (tag: string) =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const input: CreateResearchInput = {
			query: 'fan-out',
			schemaName: 'company_enrichment_v1',
			// Confirm up front so the fan-out actually launches; the unconfirmed
			// path (which returns a cost estimate instead) is covered separately.
			confirm: true,
			context: { selector: { table: 'companies', filter: { tags: [tag] } } },
		}
		const created = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			svc.create(userId, ctx.org.id, input, systemDefaults),
		)
		if (created.status === 'confirm_required')
			return yield* Effect.die(
				new Error('a confirmed selector run should not require confirmation'),
			)
		groupIds.push(created.id)

		const poll = (
			attemptsLeft: number,
		): Effect.Effect<{ status: string; children: number }, never, never> =>
			Effect.gen(function* () {
				const run = (yield* svc.get(created.id).pipe(Effect.orDie)) as {
					status?: string
					children?: unknown[]
				} | null
				const status = run?.status ?? 'unknown'
				if (TERMINAL.has(status) || attemptsLeft <= 0) {
					return { status, children: run?.children?.length ?? 0 }
				}
				yield* Effect.sleep('300 millis')
				return yield* poll(attemptsLeft - 1)
			})

		return yield* poll(60)
	}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
		{ status: string; children: number },
		never,
		never
	>

// Create a selector run WITHOUT confirming and return the raw create result —
// the cost gate should stop it before any run row is written.
const previewSelectorRun = (tag: string) =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const input: CreateResearchInput = {
			query: 'fan-out',
			schemaName: 'company_enrichment_v1',
			context: { selector: { table: 'companies', filter: { tags: [tag] } } },
		}
		const created = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			svc.create(userId, ctx.org.id, input, systemDefaults),
		).pipe(Effect.orDie)
		const result: {
			status: string
			id?: string
			subjectCount?: number
			estimatedCostCents?: number
		} =
			created.status === 'confirm_required'
				? {
						status: created.status,
						subjectCount: created.subjectCount,
						estimatedCostCents: created.estimatedCostCents,
					}
				: { status: created.status, id: created.id }
		return result
	}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
		{
			status: string
			id?: string
			subjectCount?: number
			estimatedCostCents?: number
		},
		never,
		never
	>

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
			return { org, userId: user.id }
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			{ org: Org; userId: string },
			never,
			never
		>,
	)
	ctx.org = seed.org
	userId = seed.userId
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* seedCompany()
			yield* seedCompany()
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
}, 60_000)

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const id of groupIds) {
				// Leaves cascade from the group via parent_id ON DELETE CASCADE.
				yield* sql`DELETE FROM research_runs WHERE id = ${id}::uuid OR parent_id = ${id}::uuid`
			}
			yield* sql`DELETE FROM companies WHERE ${TAG} = ANY(tags)`
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('selector fan-out', () => {
	describe('when a selector matches companies', () => {
		it('should create a leaf per company and roll the group up when none succeed', async () => {
			// GIVEN two companies matching the selector tag
			// WHEN a selector run is created and its leaves run to completion
			const result = await Effect.runPromise(createSelectorRun(TAG))

			// THEN the group has a leaf per company
			expect(result.children).toBe(2)
			// AND the group rolled up to failed even though no leaf succeeded (each
			// leaf ended no_reliable_data under the stub) — the rollup fired on a
			// non-success terminal, not only on success.
			expect(result.status).toBe('failed')
		})
	})

	describe('when a selector matches nothing', () => {
		it('should resolve the group immediately with no leaves', async () => {
			// GIVEN a selector tag no company carries
			// WHEN the run is created
			const result = await Effect.runPromise(createSelectorRun(EMPTY_TAG))

			// THEN the group has no children and completes right away
			expect(result.children).toBe(0)
			expect(result.status).toBe('succeeded')
		})
	})

	describe('when a selector matches companies but the caller did not confirm', () => {
		it('should return a cost estimate instead of starting the fan-out', async () => {
			// GIVEN two companies match the tag and the caller omits `confirm`
			// WHEN a selector run is created
			const result = await Effect.runPromise(previewSelectorRun(TAG))

			// THEN it comes back as a confirm-required estimate, not a started run
			expect(result.status).toBe('confirm_required')
			expect(result.id).toBeUndefined()
			// AND it reports how many companies the fan-out would cover
			expect(result.subjectCount).toBe(2)
			// AND it carries a non-negative estimated cost for the batch
			expect(typeof result.estimatedCostCents).toBe('number')
			expect(result.estimatedCostCents).toBeGreaterThanOrEqual(0)
		})
	})
})
