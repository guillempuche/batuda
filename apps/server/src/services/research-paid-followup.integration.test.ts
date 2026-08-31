// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '4'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import pg from 'pg'
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

import { PgLive } from '../db/client'

// Approving a pending paid action spawns a follow-up run that performs one real
// paid tool — a registry lookup or a contact discovery — charges the budget once,
// and merges the result back onto the origin run. It fails closed (no spend) when
// over the monthly cap, and refuses a tool that names no real capability (after
// coercing the aliases the model invents, e.g. email_finder → discover_contacts).
// A discover_contacts gate with no company in its args is backfilled from the
// origin run's sole company subject. RegistryRouter and ContactDiscovery are
// stubbed so no real vendor is called; the registry money movement is real DB
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
// What each approved discover follow-up asked ContactDiscovery for, so a test can
// assert the follow-up reused the run's id + budget rather than opening a new one.
interface DiscoverCall {
	companyName: string
	// Null for a company with no website — discovery accepts that and answers with
	// names and job titles instead of addresses.
	domain: string | null
	country: string | undefined
	runContextResearchId: string | undefined
}
const discoverCalls: DiscoverCall[] = []
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
			discover: input =>
				Effect.sync(() => {
					discoverCalls.push({
						companyName: input.companyName,
						domain: input.domain,
						country: input.country,
						runContextResearchId: input.runContext?.researchId,
					})
					return {
						status: 'ok' as const,
						researchId: input.runContext?.researchId ?? 'test',
						contacts: [
							{
								name: 'Dana Director',
								role: 'CEO',
								buying_role: 'economic_buyer',
								channels: [
									{
										kind: 'email',
										value: `dana@${input.domain}`,
										verification: 'deliverable',
										is_primary: true,
									},
								],
							},
						],
					}
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
// Its own company, so a ceiling set low enough to refuse one call does not
// also refuse every other case's: the ceiling counts the whole company.
const ORG_CAPPED = `paid-org-capped-${randomUUID()}`
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
	context: Record<string, unknown> | null = null,
	org: string = ORG,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, findings, paid_policy, context)
		 VALUES ($1, 'origin', 'succeeded', $2, $3::jsonb, $4::jsonb, $5::jsonb) RETURNING id`,
		[
			org,
			user,
			JSON.stringify({ pending_paid_actions: actions }),
			JSON.stringify(paidPolicy),
			JSON.stringify(context ?? {}),
		],
	)
	return r.rows[0]!.id
}

// A company the origin run can point at as its subject, so an approve can read
// the company's name + website back when a gate's own args carry neither.
const seedCompany = async (name: string, website: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, $3) RETURNING id`,
		[ORG, `c-${randomUUID()}`, name],
	)
	const id = r.rows[0]!.id
	// The website is a channel now, and the approve path reads it back from
	// there when a gate's own arguments carry no domain.
	await pool.query(
		`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, is_primary)
		 VALUES ($1, 'companies', $2, 'website', $3, true)`,
		[ORG, id, website],
	)
	return id
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

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// A ceiling below a single registry lookup, so the one case that needs a
	// refusal gets one without starving the rest.
	await pool.query(
		`INSERT INTO organization_research_policy (organization_id, paid_monthly_cap_cents)
		 VALUES ($1, 10)`,
		[ORG_CAPPED],
	)
})

afterAll(async () => {
	for (const org of [ORG, ORG_CAPPED]) {
		await pool.query(
			`DELETE FROM research_runs WHERE organization_id = $1 OR parent_id IN (SELECT id FROM research_runs WHERE organization_id = $1)`,
			[org],
		)
	}
	await pool.query(
		`DELETE FROM organization_research_policy WHERE organization_id = $1`,
		[ORG_CAPPED],
	)
	await pool.query(
		`DELETE FROM research_paid_spend WHERE organization_id = $1`,
		[ORG],
	)
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await runtime.dispose()
	await pool.end()
})

describe('paid-action follow-up', () => {
	// Approvals are made to take turns per run, so two arriving together cannot
	// both read the request as still waiting and both act on it. Forcing that
	// overlap from here is not reliable — the case below holds the invariant
	// (one request, one follow-up, however many approvals arrive) rather than
	// reproducing the collision.
	describe('when the same request is approved many times at once', () => {
		it('should start one follow-up, not one each', async () => {
			// GIVEN an origin run with one pending registry lookup
			const user = `u-race-${randomUUID()}`
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'pending',
					tool: 'registry_lookup',
					args: { country: 'ES' },
				},
			])

			// WHEN several approvals land at the same moment
			const answers = await Promise.all(
				Array.from({ length: 8 }, () => approve(origin, 'pa1', user)),
			)

			// THEN they all name the same follow-up. Any two that both read the
			// request as still waiting would each buy the lookup and each be
			// charged for it, from one person's single approval
			const ids = new Set(
				answers.map(a =>
					a.status === 'approved' ? a.followup_run_id : a.status,
				),
			)
			expect(ids.size).toBe(1)
			const firstId = [...ids][0] as string

			const followups = await pool.query<{ n: string }>(
				`SELECT count(*)::text AS n FROM research_runs WHERE parent_id = $1`,
				[origin],
			)
			expect(Number(followups.rows[0]?.n)).toBe(1)

			// AND the follow-up is left finished, so its lookup cannot land in the
			// middle of another case and be counted there
			await pollRun(firstId)
		}, 60_000)
	})

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

	describe('when a discover_contacts lookup is approved', () => {
		it('should run a follow-up that discovers contacts and merges them back', async () => {
			// GIVEN an origin run with one pending contact-discovery action
			const user = `u-disc-${randomUUID()}`
			const before = discoverCalls.length
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'pending',
					tool: 'discover_contacts',
					args: { company_name: 'Acme', domain: 'acme.com' },
				},
			])

			// WHEN it is approved and the follow-up run completes
			const result = await approve(origin, 'pa1', user)
			expect(result.status).toBe('approved')
			const followupId =
				result.status === 'approved' ? result.followup_run_id : ''
			expect(await pollRun(followupId)).toBe('succeeded')

			// THEN discovery ran once, reusing the follow-up run's own id + budget
			// (not a fresh anchor run)
			expect(discoverCalls.length).toBe(before + 1)
			expect(discoverCalls.at(-1)).toEqual({
				companyName: 'Acme',
				domain: 'acme.com',
				country: undefined,
				runContextResearchId: followupId,
			})

			// AND the discovered contacts are recorded on the origin run
			const findings = await originFindings(origin)
			expect(findings.followup_results?.length).toBe(1)
			const merged = findings.followup_results?.[0] as {
				tool: string
				result: { status: string; contacts: unknown[] }
			}
			expect(merged.tool).toBe('discover_contacts')
			expect(merged.result.status).toBe('ok')
			expect(merged.result.contacts.length).toBe(1)
			expect(findings.pending_paid_actions?.[0]?.['status']).toBe('approved')
		})
	})

	describe('when the action names an invented contact tool', () => {
		it('should coerce email_finder to discover_contacts and approve it', async () => {
			// GIVEN the exact failure from production: the model wrote a hallucinated
			// tool name for what contact discovery does
			const user = `u-alias-${randomUUID()}`
			const before = discoverCalls.length
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'pending',
					tool: 'email_finder',
					args: { company_name: 'Acme', domain: 'acme.com' },
				},
			])

			// WHEN it is approved
			const result = await approve(origin, 'pa1', user)

			// THEN the name is coerced to the real tool and the follow-up runs it
			expect(result.status).toBe('approved')
			const followupId =
				result.status === 'approved' ? result.followup_run_id : ''
			expect(await pollRun(followupId)).toBe('succeeded')
			expect(discoverCalls.length).toBe(before + 1)
			const findings = await originFindings(origin)
			const merged = findings.followup_results?.[0] as { tool: string }
			expect(merged.tool).toBe('discover_contacts')
		})
	})

	describe('when a discover_contacts action is missing its domain', () => {
		it('should fail the follow-up closed rather than guess', async () => {
			// GIVEN a contact-discovery action whose args carry no domain to search
			const user = `u-nodom-${randomUUID()}`
			const before = discoverCalls.length
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'pending',
					tool: 'discover_contacts',
					args: { company_name: 'Acme' },
				},
			])

			// WHEN it is approved and the follow-up runs
			const result = await approve(origin, 'pa1', user)
			const followupId =
				result.status === 'approved' ? result.followup_run_id : ''
			expect(await pollRun(followupId)).toBe('failed')

			// THEN discovery was never called and the origin records the failure
			expect(discoverCalls.length).toBe(before)
			const findings = await originFindings(origin)
			expect(findings.followup_results?.length).toBe(1)
		})
	})

	describe('when a discover_contacts action carries no company at all', () => {
		it('should backfill it from the origin run single company subject', async () => {
			// GIVEN a run about one company and a gate whose args are empty
			const user = `u-backfill-${randomUUID()}`
			const before = discoverCalls.length
			const companyId = await seedCompany(
				'Backfill Co',
				'https://www.backfillco.com/',
			)
			const origin = await seedOrigin(
				user,
				[{ id: 'pa1', status: 'pending', tool: 'discover_contacts', args: {} }],
				policy({}),
				{ subjects: [{ table: 'companies', id: companyId }] },
			)

			// WHEN it is approved and the follow-up runs
			const result = await approve(origin, 'pa1', user)
			expect(result.status).toBe('approved')
			const followupId =
				result.status === 'approved' ? result.followup_run_id : ''
			expect(await pollRun(followupId)).toBe('succeeded')

			// THEN discovery ran for that company, its website reduced to a bare
			// domain
			expect(discoverCalls.length).toBe(before + 1)
			expect(discoverCalls.at(-1)).toEqual({
				companyName: 'Backfill Co',
				domain: 'backfillco.com',
				country: undefined,
				runContextResearchId: followupId,
			})
		})
	})

	describe('when a gate has no company and the run spans several', () => {
		it('should fail rather than guess which company was meant', async () => {
			// GIVEN a gate with empty args on a run linked to two companies
			const user = `u-multi-${randomUUID()}`
			const before = discoverCalls.length
			const one = await seedCompany('One Co', 'https://one.com')
			const two = await seedCompany('Two Co', 'https://two.com')
			const origin = await seedOrigin(
				user,
				[{ id: 'pa1', status: 'pending', tool: 'discover_contacts', args: {} }],
				policy({}),
				{
					subjects: [
						{ table: 'companies', id: one },
						{ table: 'companies', id: two },
					],
				},
			)

			// WHEN it is approved and the follow-up runs
			const result = await approve(origin, 'pa1', user)
			const followupId =
				result.status === 'approved' ? result.followup_run_id : ''
			expect(await pollRun(followupId)).toBe('failed')

			// THEN no company was assumed and discovery never ran
			expect(discoverCalls.length).toBe(before)
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

	describe('when the action was already marked as naming no real tool', () => {
		it('should still say the tool is the problem, not the status', async () => {
			// GIVEN an action stored the way a run writes one now: a tool that does
			// not exist, marked so it stops waiting on anybody
			const user = `u-unsup-${randomUUID()}`
			const origin = await seedOrigin(user, [
				{
					id: 'pa1',
					status: 'unsupported',
					tool: 'employee_count_estimation',
					args: {},
				},
			])

			// WHEN somebody holding its id approves it anyway
			const result = await approve(origin, 'pa1', user)

			// THEN it is told what actually happened. Reading the status first would
			// answer "somebody already decided this", which nobody did
			expect(result.status).toBe('unsupported_tool')
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
				policy({}),
				null,
				ORG_CAPPED,
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
