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
import { queryPendingProposals, resolvePolicy } from '@batuda/research'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { Geocoder } from './geocoder'
import { resolveResearchProposedUpdate } from './research-apply'
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

// Mirror the sink's decision: eligible = machine-checkable + confidence at or
// above the threshold, kept only when the email verdict is deliverable.
const autoApply = (research: string, threshold: number) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const eligible = yield* queryPendingProposals(sql, {
			researchId: research,
			machineCheckable: true,
			minConfidence: threshold,
		})
		const deliverable = eligible.items.filter(
			(p): p is typeof p & { proposedUpdateId: string } =>
				p.verification === 'deliverable' && p.proposedUpdateId !== null,
		)
		yield* Effect.forEach(deliverable, p =>
			resolveResearchProposedUpdate(
				research,
				p.proposedUpdateId,
				'apply',
				null,
			),
		)
		return deliverable.map(p => p.proposedUpdateId)
	}).pipe(
		Effect.provideService(CurrentOrg, { id: ORG, name: 'a', slug: 'a' }),
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
})
