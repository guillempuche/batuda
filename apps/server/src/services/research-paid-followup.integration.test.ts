// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '4'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	ExtractLanguageModel,
	ExtractProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client'

// Approving a pending paid action spawns a follow-up run that performs one
// whitelisted paid call, charges the budget once, and merges the result back
// onto the origin run — and fails closed (no spend) when over the monthly cap
// or when the tool isn't one we execute. The RegistryRouter is stubbed to a
// fixed record so no real vendor is called; the money movement is real DB
// writes to research_paid_spend.

const stubResponse = {
	text: '',
	content: [{ type: 'text' as const, text: '' }],
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
	generateObject: () => Effect.succeed({ ...stubResponse, value: {} }) as never,
	streamText: () =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

let registryCalls = 0
const die = 'provider not exercised'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(die) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(die) }),
	),
	Layer.succeed(ExtractProvider)(
		ExtractProvider.of({ extract: () => Effect.die(die) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({
			lookup: () =>
				Effect.sync(() => {
					registryCalls++
					return { country: 'ES', name: 'Acme S.L.' } as never
				}),
		}),
	),
)
const llmLayer = Layer.mergeAll(
	Layer.succeed(AgentLanguageModel)(stubLlm),
	Layer.succeed(ExtractLanguageModel)(stubLlm),
	Layer.succeed(WriterLanguageModel)(stubLlm),
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
	Layer.provide(
		Layer.succeed(ResearchEventSink)(
			ResearchEventSink.of({ fire: () => Effect.void }),
		),
	),
	Layer.provideMerge(PgLive),
)

const runtime = ManagedRuntime.make(ResearchLive)
const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `paid-org-${randomUUID()}`
const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

let pool: pg.Pool

const policy = (overrides: Record<string, number>) => ({
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	autoApplyMinConfidence: null,
	...overrides,
})

const seedOrigin = async (
	user: string,
	actions: Array<Record<string, unknown>>,
	paidPolicy: Record<string, unknown> = policy({}),
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, findings, paid_policy)
		 VALUES ($1, 'origin', 'succeeded', $2, $3::jsonb, $4::jsonb) RETURNING id`,
		[
			ORG,
			user,
			JSON.stringify({ pending_paid_actions: actions }),
			JSON.stringify(paidPolicy),
		],
	)
	return r.rows[0]!.id
}

const approve = (runId: string, paId: string, user: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			return yield* svc.approvePaidAction(runId, paId, user)
		}),
	)

const skip = (runId: string, paId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			return yield* svc.skipPaidAction(runId, paId)
		}),
	)

const pollRun = (id: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const poll = (left: number): Effect.Effect<string, never, never> =>
				Effect.gen(function* () {
					const run = (yield* svc.get(id).pipe(Effect.orDie)) as {
						status?: string
					} | null
					const status = run?.status ?? 'unknown'
					if (TERMINAL.has(status) || left <= 0) return status
					yield* Effect.sleep('300 millis')
					return yield* poll(left - 1)
				})
			return yield* poll(40)
		}),
	)

const spendCount = async (user: string): Promise<number> => {
	const r = await pool.query<{ n: number }>(
		`SELECT COUNT(*)::int AS n FROM research_paid_spend WHERE user_id = $1`,
		[user],
	)
	return r.rows[0]?.n ?? 0
}

const spendTools = async (user: string): Promise<string[]> => {
	const r = await pool.query<{ tool: string }>(
		`SELECT tool FROM research_paid_spend WHERE user_id = $1 ORDER BY at`,
		[user],
	)
	return r.rows.map(row => row.tool)
}

const originFindings = async (
	id: string,
): Promise<{
	followup_results?: unknown[]
	pending_paid_actions?: Array<Record<string, unknown>>
}> => {
	const r = await pool.query<{ findings: Record<string, unknown> }>(
		`SELECT findings FROM research_runs WHERE id = $1`,
		[id],
	)
	return r.rows[0]!.findings
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM research_runs WHERE organization_id = $1 OR parent_id IN (SELECT id FROM research_runs WHERE organization_id = $1)`,
		[ORG],
	)
	await pool.query(
		`DELETE FROM research_paid_spend WHERE organization_id = $1`,
		[ORG],
	)
	await runtime.dispose()
	await pool.end()
})

describe('paid-action follow-up', () => {
	describe('when a registry lookup is approved', () => {
		it('should run a follow-up that charges once and merges the result back', async () => {
			// GIVEN an origin run with one pending registry lookup
			const user = `u-happy-${randomUUID()}`
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'pending',
					tool: 'registry_lookup',
					args: { country: 'ES', tax_id: 'B123' },
				},
			])
			const before = registryCalls

			// WHEN it is approved and the follow-up run completes
			const result = await approve(origin, 'pa1', user)
			expect(result.status).toBe('approved')
			const followupId =
				result.status === 'approved' ? result.followup_run_id : ''
			expect(await pollRun(followupId)).toBe('succeeded')

			// THEN the paid call ran once, charged once, and the result is on the
			// origin run
			expect(registryCalls).toBe(before + 1)
			expect(await spendCount(user)).toBe(1)
			// AND the spend row records the real tool name, so a by-tool
			// breakdown is meaningful (not the old hardcoded 'paid')
			expect(await spendTools(user)).toEqual(['registry_lookup'])
			const findings = await originFindings(origin)
			expect(findings.followup_results?.length).toBe(1)
			expect(findings.pending_paid_actions?.[0]?.['status']).toBe('approved')
			expect(findings.pending_paid_actions?.[0]?.['followup_run_id']).toBe(
				followupId,
			)
		})
	})

	describe('when the same action is approved again', () => {
		it('should return the same follow-up and never charge twice', async () => {
			// GIVEN a run whose action was already approved and executed
			const user = `u-idem-${randomUUID()}`
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'pending',
					tool: 'registry_lookup',
					args: { country: 'ES' },
				},
			])
			const first = await approve(origin, 'pa1', user)
			const firstId = first.status === 'approved' ? first.followup_run_id : 'a'
			await pollRun(firstId)

			// WHEN the same action is approved a second time
			const second = await approve(origin, 'pa1', user)
			const secondId =
				second.status === 'approved' ? second.followup_run_id : 'b'

			// THEN it returns the same follow-up and the spend stays at one
			expect(secondId).toBe(firstId)
			expect(await spendCount(user)).toBe(1)
		})
	})

	describe('when a paid action is skipped', () => {
		it('should record the decision and spend nothing', async () => {
			// GIVEN a pending action
			const user = `u-skip-${randomUUID()}`
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'pending',
					tool: 'registry_lookup',
					args: { country: 'ES' },
				},
			])

			// WHEN it is skipped
			const result = await skip(origin, 'pa1')

			// THEN it is marked skipped and no money moved
			expect(result.status).toBe('skipped')
			const findings = await originFindings(origin)
			expect(findings.pending_paid_actions?.[0]?.['status']).toBe('skipped')
			expect(await spendCount(user)).toBe(0)
		})
	})

	describe('when the action names a tool we do not execute', () => {
		it('should refuse it without spending', async () => {
			// GIVEN an action for a tool outside the whitelist
			const user = `u-tool-${randomUUID()}`
			const origin = await seedOrigin(user, [
				{ id: 'pa1', status: 'pending', tool: 'paid_report', args: {} },
			])

			// WHEN it is approved
			const result = await approve(origin, 'pa1', user)

			// THEN it is refused and nothing is spawned or spent
			expect(result.status).toBe('unsupported_tool')
			expect(await spendCount(user)).toBe(0)
		})
	})

	describe('when the follow-up would exceed the monthly cap', () => {
		it('should fail closed with no spend', async () => {
			// GIVEN a run whose monthly cap is below one lookup's cost
			const user = `u-cap-${randomUUID()}`
			const origin = await seedOrigin(
				user,
				[
					{
						id: 'pa1',
						status: 'pending',
						tool: 'registry_lookup',
						args: { country: 'ES' },
					},
				],
				policy({ paidMonthlyCapCents: 10 }),
			)

			// WHEN it is approved and the follow-up runs
			const result = await approve(origin, 'pa1', user)
			const followupId =
				result.status === 'approved' ? result.followup_run_id : ''
			expect(await pollRun(followupId)).toBe('failed')

			// THEN no money moved and the origin records the failed attempt
			expect(await spendCount(user)).toBe(0)
			const findings = await originFindings(origin)
			expect(findings.followup_results?.length).toBe(1)
		})
	})
})
