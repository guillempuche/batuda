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
	MapProvider,
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
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
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

// `asked` carries whatever the caller states; leaving schemaName out of it is
// how a request that names no kind of run is exercised.
const createSelectorRun = (tag: string, asked: CreateResearchInput) =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const input: CreateResearchInput = {
			...asked,
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

		const settled = yield* poll(60)
		// The kind written onto the group and onto every company it fanned out to.
		const rows = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			sql<{ kind: string; schemaName: string | null }>`
				SELECT kind, schema_name AS "schemaName" FROM research_runs
				WHERE id = ${created.id} OR parent_id = ${created.id}
			`,
		)
		return {
			...settled,
			kinds: rows.map(row => `${row.kind}:${row.schemaName}`),
		}
	}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
		{ status: string; children: number; kinds: Array<string> },
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

// Seed a group with a single in-flight leaf (mimicking a fan-out caught
// mid-run), cancel that leaf, and read the group's status back. Cancelling the
// last leaf must roll the group up: a cancelled leaf counts as a non-success,
// and the cancel itself triggers the roll-up, so the group never hangs in
// 'running' with no fiber left to resolve it.
const cancelLeafAndReadGroup = () =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const seeded = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			Effect.gen(function* () {
				const [group] = yield* sql<{ id: string }>`
					INSERT INTO research_runs (organization_id, kind, query, status, created_by)
					VALUES (${ctx.org.id}, 'group', 'cancel-rollup', 'running', ${userId})
					RETURNING id
				`
				const [leaf] = yield* sql<{ id: string }>`
					INSERT INTO research_runs (organization_id, parent_id, kind, query, status, created_by)
					VALUES (${ctx.org.id}, ${group?.id}, 'leaf', 'cancel-rollup', 'running', ${userId})
					RETURNING id
				`
				if (!group || !leaf)
					return yield* Effect.die(new Error('fixture insert returned no row'))
				return { groupId: group.id, leafId: leaf.id }
			}),
		)
		groupIds.push(seeded.groupId)
		yield* enterOrgScope(sql, { org: ctx.org, userId })(
			svc.cancel(seeded.leafId),
		)
		const group = (yield* svc.get(seeded.groupId).pipe(Effect.orDie)) as {
			status?: string
		} | null
		return group?.status ?? 'unknown'
	}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<string, never, never>

// Seed a group with two in-flight leaves, cancel the group itself, and read the
// group's and every leaf's status back. Cancelling a group must stop the whole
// fan-out: the group and all its leaves end cancelled, none left running.
const cancelGroupAndReadStatuses = () =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const groupId = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			Effect.gen(function* () {
				const [group] = yield* sql<{ id: string }>`
					INSERT INTO research_runs (organization_id, kind, query, status, created_by)
					VALUES (${ctx.org.id}, 'group', 'group-cancel', 'running', ${userId})
					RETURNING id
				`
				if (!group)
					return yield* Effect.die(new Error('group insert returned no row'))
				yield* sql`
					INSERT INTO research_runs (organization_id, parent_id, kind, query, status, created_by)
					VALUES
						(${ctx.org.id}, ${group.id}, 'leaf', 'group-cancel', 'running', ${userId}),
						(${ctx.org.id}, ${group.id}, 'leaf', 'group-cancel', 'running', ${userId})
				`
				return group.id
			}),
		)
		groupIds.push(groupId)
		yield* enterOrgScope(sql, { org: ctx.org, userId })(svc.cancel(groupId))
		const rows = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			sql<{ status: string; kind: string }>`
				SELECT status, kind FROM research_runs
				WHERE id = ${groupId} OR parent_id = ${groupId}
			`,
		)
		return rows.map(row => `${row.kind}:${row.status}`)
	}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<
		Array<string>,
		never,
		never
	>

// A paid follow-up run hangs off its origin run via parent_id, but the origin
// already finished — cancelling the follow-up must not recompute the origin's
// status the way cancelling a group's leaf recomputes the group.
const cancelFollowupAndReadOrigin = () =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const seeded = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			Effect.gen(function* () {
				const [origin] = yield* sql<{ id: string }>`
					INSERT INTO research_runs (organization_id, kind, query, status, created_by)
					VALUES (${ctx.org.id}, 'leaf', 'origin', 'succeeded', ${userId})
					RETURNING id
				`
				if (!origin)
					return yield* Effect.die(new Error('origin insert returned no row'))
				const [followup] = yield* sql<{ id: string }>`
					INSERT INTO research_runs (organization_id, parent_id, kind, query, status, created_by)
					VALUES (${ctx.org.id}, ${origin.id}, 'followup', 'paid follow-up', 'running', ${userId})
					RETURNING id
				`
				if (!followup)
					return yield* Effect.die(new Error('followup insert returned no row'))
				return { originId: origin.id, followupId: followup.id }
			}),
		)
		groupIds.push(seeded.originId)
		yield* enterOrgScope(sql, { org: ctx.org, userId })(
			svc.cancel(seeded.followupId),
		)
		const [origin] = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			sql<{ status: string }>`
				SELECT status FROM research_runs WHERE id = ${seeded.originId}
			`,
		)
		return origin?.status ?? 'unknown'
	}).pipe(Effect.provide(ResearchLive)) as Effect.Effect<string, never, never>

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
			const result = await Effect.runPromise(
				createSelectorRun(TAG, {
					query: 'fan-out',
					schemaName: 'company_enrichment_v1',
				}),
			)

			// THEN the group has a leaf per company
			expect(result.children).toBe(2)
			// AND the group rolled up to failed even though no leaf succeeded (each
			// leaf ended no_reliable_data under the stub) — the rollup fired on a
			// non-success terminal, not only on success.
			expect(result.status).toBe('failed')
		})
	})

	describe('when a selector request names no kind of run', () => {
		it('should settle on one kind and write it onto the group and every leaf', async () => {
			// GIVEN a filtered request that says nothing about the shape of answer
			// it wants
			// WHEN it is created and fans out
			const result = await Effect.runPromise(
				createSelectorRun(TAG, { query: 'fan-out naming no kind' }),
			)

			// THEN the group and each company it covers were all written down as the
			// same kind of run — the kind the request settled on is what the answer
			// is filed under and what the lookup for it is built from, so a leaf
			// disagreeing with its group would put an answer somewhere nothing looks
			expect([...result.kinds].sort()).toEqual([
				'group:company_enrichment_v1',
				'leaf:company_enrichment_v1',
				'leaf:company_enrichment_v1',
			])
		})
	})

	describe("when a group's last leaf is cancelled", () => {
		it('should roll the group up to failed rather than leave it hanging in running', async () => {
			// GIVEN a group whose single leaf is still in flight
			// WHEN that leaf is cancelled
			const status = await Effect.runPromise(cancelLeafAndReadGroup())

			// THEN the group resolves to a terminal failed state — 'running' would
			// mean the cancel never rolled the parent up, 'succeeded' would mean a
			// cancelled leaf was miscounted as a success.
			expect(status).toBe('failed')
		})
	})

	describe('when a whole group is cancelled', () => {
		it('should cancel the group and all its in-flight leaves, leaving none running', async () => {
			// GIVEN a group with two leaves still in flight
			// WHEN the group itself is cancelled
			const statuses = await Effect.runPromise(cancelGroupAndReadStatuses())

			// THEN the group and every leaf end cancelled — the fan-out stops as a
			// whole, and no leaf is left running to spend or to revive the group.
			expect(statuses).toHaveLength(3)
			expect(statuses.every(s => s.endsWith(':cancelled'))).toBe(true)
		})
	})

	describe('when a paid follow-up run is cancelled', () => {
		it('should leave its origin run untouched rather than recomputing it', async () => {
			// GIVEN a finished (succeeded) origin run with a follow-up still running
			// WHEN the follow-up is cancelled
			const originStatus = await Effect.runPromise(
				cancelFollowupAndReadOrigin(),
			)

			// THEN the origin keeps its succeeded status — a follow-up's outcome must
			// never roll the origin up the way a group's leaf rolls up its group.
			expect(originStatus).toBe('succeeded')
		})
	})

	describe('when a selector matches nothing', () => {
		it('should resolve the group immediately with no leaves', async () => {
			// GIVEN a selector tag no company carries
			// WHEN the run is created
			const result = await Effect.runPromise(
				createSelectorRun(EMPTY_TAG, {
					query: 'fan-out',
					schemaName: 'company_enrichment_v1',
				}),
			)

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
			// AND the figure quoted covers both halves of what the batch may
			// spend: 100c of searching per company, plus paid vendor data as far
			// as the month still allows (2 x 500c, under a 2000c ceiling). Quoting
			// the paid half alone would say 1000c and leave out the searching
			expect(result.estimatedCostCents).toBe(2 * 100 + 2 * 500)
		})
	})
})
