// Live-DB integration test for confidence-aware auto-apply: the policy read
// freezes the per-user threshold, and the run-completion decision applies only
// the findings that are machine-checkable, verified deliverable, and confident
// enough — everything else stays pending for review. The decision mirrors the
// event sink's rule, exercising the real query + apply the sink calls.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import { resolvePolicy } from '@batuda/research'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { Geocoder } from './geocoder'
import { resolveResearchProposedUpdate } from './research-apply'
import { proposalsToAutoApply } from './research-auto-apply'
import { TimelineActivityService } from './timeline-activity'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `auto-org-${randomUUID()}`
const USER = `auto-user-${randomUUID()}`

const SYSTEM_DEFAULTS = {
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	hardCeiling: 10000,
}

const runtime = ManagedRuntime.make(PgLive)

const deps = Layer.mergeAll(
	TimelineActivityService.layer,
	CompanyService.layer,
	Geocoder.layer,
).pipe(Layer.provide(FetchHttpClient.layer), Layer.provideMerge(PgLive))

let pool: pg.Pool
let companyId: string
let runId: string

const policyFor = (userId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* resolvePolicy({
				sql,
				userId,
				systemDefaults: SYSTEM_DEFAULTS,
			})
		}),
	)

// Exercises the real rule the server uses, rather than a copy of it: a copy
// passes just as happily when the rule it imitates is deleted.
const autoApply = (research: string, threshold: number) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const [row] = yield* sql<{ status: string }>`
			SELECT status FROM research_runs WHERE id = ${research}::uuid
		`
		const toApply = yield* proposalsToAutoApply(sql, {
			researchId: research,
			runStatus: row?.status ?? '',
			autoApplyMinConfidence: threshold,
		})
		yield* Effect.forEach(toApply, id =>
			resolveResearchProposedUpdate(research, id, 'apply', null, {
				origin: 'unattended',
			}),
		)
		return toApply
	}).pipe(
		Effect.provideService(CurrentOrg, {
			id: ORG,
			name: 'a',
			slug: 'a',
			role: 'member',
		}),
		Effect.provide(deps),
		Effect.orDie,
		Effect.runPromise,
	)

const pending = (over: Record<string, unknown>) => ({
	id: randomUUID(),
	status: 'pending',
	reason: 'r',
	citations: [],
	...over,
})

const channel = (verification: string, confidence: number) => ({
	kind: 'email',
	value: `${randomUUID()}@x.es`,
	verification,
	confidence,
})

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[ORG, `acme-${randomUUID()}`],
	)
	companyId = company.rows[0]!.id
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM user_research_policy WHERE user_id = $1`, [
		USER,
	])
	await pool.query(`DELETE FROM timeline_activity WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await runtime.dispose()
	await pool.end()
})

describe('resolvePolicy auto-apply threshold', () => {
	describe('when the user set a threshold', () => {
		it('should freeze it onto the resolved policy', async () => {
			// GIVEN a user policy with an auto-apply threshold
			await pool.query(
				`INSERT INTO user_research_policy (user_id, auto_apply_min_confidence)
				 VALUES ($1, 80)
				 ON CONFLICT (user_id) DO UPDATE SET auto_apply_min_confidence = 80`,
				[USER],
			)

			// WHEN the policy is resolved
			const policy = await policyFor(USER)

			// THEN the threshold rides along
			expect(policy.autoApplyMinConfidence).toBe(80)
		})
	})

	describe('when the user set no threshold', () => {
		it('should resolve to null so auto-apply stays off', async () => {
			// GIVEN a user with no policy row at all
			// WHEN the policy is resolved
			const policy = await policyFor(`nobody-${randomUUID()}`)

			// THEN auto-apply is disabled by default
			expect(policy.autoApplyMinConfidence).toBeNull()
		})
	})
})

describe('auto-apply decision', () => {
	it('should apply only verified, confident, machine-checkable findings', async () => {
		// GIVEN a completed run whose findings mix a strong verified contact, a
		// low-confidence one, a free-text company update, and a risky-verdict one
		const run = await pool.query<{ id: string }>(
			`INSERT INTO research_runs (organization_id, query, status, created_by, findings)
			 VALUES ($1, 'q', 'succeeded', $2, $3::jsonb) RETURNING id`,
			[
				ORG,
				USER,
				JSON.stringify({
					proposed_updates: [
						pending({
							id: 'strong',
							subject_table: 'contacts',
							operation: 'create',
							fields: {
								name: 'Strong',
								company_id: companyId,
								channels: [channel('deliverable', 0.95)],
							},
						}),
						pending({
							id: 'lowconf',
							subject_table: 'contacts',
							operation: 'create',
							fields: {
								name: 'Low',
								company_id: companyId,
								channels: [channel('deliverable', 0.5)],
							},
						}),
						pending({
							id: 'freetext',
							subject_table: 'companies',
							subject_id: companyId,
							operation: 'update',
							expected_version: 0,
							fields: { industry: 'logistics' },
						}),
						pending({
							id: 'risky',
							subject_table: 'contacts',
							operation: 'create',
							fields: {
								name: 'Risky',
								company_id: companyId,
								channels: [channel('risky', 0.99)],
							},
						}),
					],
				}),
			],
		)
		runId = run.rows[0]!.id

		// WHEN the completion decision runs with a threshold of 80
		const applied = await autoApply(runId, 80)

		// THEN only the strong, verified, confident finding is applied
		expect(applied).toEqual(['strong'])

		// AND the others are left pending for a human
		const res = await pool.query<{
			findings: { proposed_updates: Array<{ id: string; status: string }> }
		}>(`SELECT findings FROM research_runs WHERE id = $1`, [runId])
		const byId = new Map(
			res.rows[0]!.findings.proposed_updates.map(p => [p.id, p.status]),
		)
		expect(byId.get('strong')).toBe('applied')
		expect(byId.get('lowconf')).toBe('pending')
		expect(byId.get('freetext')).toBe('pending')
		expect(byId.get('risky')).toBe('pending')
	})

	it('should leave a run that needs reading entirely alone', async () => {
		// GIVEN a run that finished unsure which company it was about, carrying a
		//   suggestion that is otherwise as good as they get: machine-checkable,
		//   fully confident, and a deliverable address
		const company = await pool.query<{ id: string }>(
			`INSERT INTO companies (organization_id, slug, name)
			 VALUES ($1, $2, 'Lookalike') RETURNING id`,
			[ORG, `lookalike-${randomUUID()}`],
		)
		const lookalikeId = company.rows[0]!.id
		const run = await pool.query<{ id: string }>(
			`INSERT INTO research_runs (organization_id, query, status, created_by, findings)
			 VALUES ($1, 'q', 'succeeded_low_confidence', $2, $3::jsonb) RETURNING id`,
			[
				ORG,
				USER,
				JSON.stringify({
					proposed_updates: [
						pending({
							id: 'unsure',
							subject_table: 'contacts',
							operation: 'create',
							fields: {
								name: 'Unsure',
								company_id: lookalikeId,
								channels: [channel('deliverable', 0.99)],
							},
						}),
					],
				}),
			],
		)

		// WHEN the completion decision runs
		const applied = await autoApply(run.rows[0]!.id, 80)

		// THEN nothing is written: how good the address is says nothing about
		//   whether it belongs to the company that was asked about, which is the
		//   very thing this run could not settle
		expect(applied).toEqual([])
		const res = await pool.query<{
			findings: { proposed_updates: Array<{ id: string; status: string }> }
		}>(`SELECT findings FROM research_runs WHERE id = $1`, [run.rows[0]!.id])
		expect(res.rows[0]!.findings.proposed_updates[0]!.status).toBe('pending')
	})
})

// The rule this holds to is written out in docs/architecture.md, under "What an
// apply writes". Changing what happens here means changing it there.
describe('what an unattended apply may write onto a company', () => {
	it("should leave a person's account notes alone", async () => {
		// GIVEN a company whose notes a person wrote
		const company = await pool.query<{ id: string }>(
			`INSERT INTO companies (organization_id, slug, name, account_brief)
			 VALUES ($1, $2, 'Notas', 'Met them at the fair. Ask for Mar.')
			 RETURNING id`,
			[ORG, `notas-${randomUUID()}`],
		)
		const id = company.rows[0]!.id

		// AND a finished run about that company, carrying its own written brief
		// and one reachable address for the company itself
		const run = await pool.query<{ id: string }>(
			`INSERT INTO research_runs (organization_id, query, status, created_by, findings, brief_md, context)
			 VALUES ($1, 'q', 'succeeded', $2, $3::jsonb, $4, $5::jsonb) RETURNING id`,
			[
				ORG,
				USER,
				JSON.stringify({
					proposed_updates: [
						pending({
							id: 'companymail',
							subject_table: 'companies',
							subject_id: id,
							operation: 'update',
							expected_version: 0,
							fields: {
								industry: 'logistics',
								channels: [channel('deliverable', 0.95)],
							},
						}),
					],
				}),
				'## Notas — 2026-08-25\n\nWritten by the run.',
				JSON.stringify({ subjects: [{ table: 'companies', id }] }),
			],
		)

		// WHEN the server applies what it may on its own
		const applied = await autoApply(run.rows[0]!.id, 50)

		// THEN whatever it decided to write, the person's notes are still theirs
		const row = await pool.query<{
			account_brief: string | null
			industry: string | null
		}>(`SELECT account_brief, industry FROM companies WHERE id = $1`, [id])
		expect(row.rows[0]?.account_brief).toBe(
			'Met them at the fair. Ask for Mar.',
		)
		expect(applied).toEqual(['companymail'])
		// The write really landed — without this the assertion above passes just
		// as happily on a proposal that never reached the company at all.
		expect(row.rows[0]?.industry).toBe('logistics')
	})
})
