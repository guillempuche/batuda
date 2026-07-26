// Live-DB integration test for the in-run auto-approve gate. When enforced,
// Budget.chargePaid must refuse a paid charge that would push a run's spend past
// the caller's auto-approve limit — with ApprovalRequired, spending nothing —
// so a user who sets auto_approve_paid_cents low is actually protected inside a
// research run. When not enforced (the standalone tool gates interactively; an
// approved follow-up must charge), the per-run budget stays the only ceiling.
//
// Prereq: `pnpm cli services up` — this suite's own globalSetup builds and
// migrates the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Budget, makeBudgetLayer, resolvePolicy } from '@batuda/research'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = `aa-org-${randomUUID()}`
const USER = `aa-u1-${randomUUID()}`

// Budgets high enough that only the auto-approve limit — set per test — can
// reject a charge, never the per-run budget or the monthly cap.
const BASE_DEFAULTS = {
	budgetCents: 100_000,
	paidBudgetCents: 100_000,
	autoApprovePaidCents: 100_000,
	paidMonthlyCapCents: 100_000,
	hardCeiling: 100_000,
}

let pool: pg.Pool

const seedRun = async (): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by)
		 VALUES ($1, 'aa query', 'succeeded', $2) RETURNING id`,
		[ORG, USER],
	)
	return r.rows[0]?.id ?? ''
}

// Charge zero or more setup calls against ONE Budget instance built with the
// given auto-approve limit + enforcement, then capture the outcome of one final
// charge via Effect.result — a typed failure (ApprovalRequired, BudgetExceeded)
// resolves as a value; only an unexpected defect still rejects the promise.
const chargeThenObserve = (
	researchId: string,
	autoApprovePaidCents: number,
	enforceAutoApprove: boolean,
	setupCharges: ReadonlyArray<{ readonly cents: number; readonly key: string }>,
	observedCharge: { readonly cents: number; readonly key: string },
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const policy = yield* resolvePolicy({
				sql,
				userId: USER,
				systemDefaults: { ...BASE_DEFAULTS, autoApprovePaidCents },
			})
			const budgetLayer = makeBudgetLayer({
				organizationId: ORG,
				userId: USER,
				researchId,
				policy,
				defaultCapCents: 2000,
				systemCeiling: BASE_DEFAULTS.hardCeiling,
				enforceAutoApprove,
			}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

			return yield* Effect.gen(function* () {
				const budget = yield* Budget
				for (const { cents, key } of setupCharges) {
					yield* budget.chargePaid(
						'test-provider',
						cents,
						'discover_contacts',
						key,
					)
				}
				return yield* Effect.result(
					budget.chargePaid(
						'test-provider',
						observedCharge.cents,
						'discover_contacts',
						observedCharge.key,
					),
				)
			}).pipe(Effect.provide(budgetLayer))
		}),
	)

const spendRowCount = async (researchId: string): Promise<number> => {
	const r = await pool.query(
		`SELECT id FROM research_paid_spend WHERE research_id = $1`,
		[researchId],
	)
	return r.rows.length
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	// research_paid_spend.research_id cascades from research_runs, so deleting
	// the runs alone clears both tables.
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await runtime.dispose()
	await pool.end()
})

describe('enforcing the in-run auto-approve limit', () => {
	describe('when enforced and the first paid charge is over the limit', () => {
		it('should refuse with ApprovalRequired and spend nothing', async () => {
			// GIVEN a run whose policy auto-approves 0 paid cents, enforced in-run
			const researchId = await seedRun()
			// WHEN any paid call is charged
			const outcome = await chargeThenObserve(researchId, 0, true, [], {
				cents: 5,
				key: `key-${randomUUID()}`,
			})
			// THEN it fails with the approval gate, not a silent charge
			expect(outcome._tag).toBe('Failure')
			if (outcome._tag === 'Failure') {
				expect(outcome.failure._tag).toBe('ApprovalRequired')
			}
			// AND no money moved
			expect(await spendRowCount(researchId)).toBe(0)
		})
	})

	describe('when enforced and cumulative spend crosses the limit', () => {
		it('should charge up to the limit, then gate the charge that exceeds it', async () => {
			// GIVEN a run auto-approving 5 paid cents, enforced
			const researchId = await seedRun()
			// WHEN a 5-cent charge (reaching the limit) is followed by another
			const outcome = await chargeThenObserve(
				researchId,
				5,
				true,
				[{ cents: 5, key: `key-${randomUUID()}` }],
				{ cents: 5, key: `key-${randomUUID()}` },
			)
			// THEN the second (which would total 10 > 5) is gated
			expect(outcome._tag).toBe('Failure')
			if (outcome._tag === 'Failure') {
				expect(outcome.failure._tag).toBe('ApprovalRequired')
			}
			// AND only the first, within-limit charge was recorded
			expect(await spendRowCount(researchId)).toBe(1)
		})
	})

	describe('when enforced and the charge stays within the limit', () => {
		it('should charge normally', async () => {
			// GIVEN a run auto-approving 100 paid cents, enforced
			const researchId = await seedRun()
			// WHEN a 5-cent call (well under the limit) is charged
			const outcome = await chargeThenObserve(researchId, 100, true, [], {
				cents: 5,
				key: `key-${randomUUID()}`,
			})
			// THEN it succeeds and records the spend
			expect(outcome._tag).toBe('Success')
			expect(await spendRowCount(researchId)).toBe(1)
		})
	})

	describe('when not enforced (standalone tool or approved follow-up)', () => {
		it('should charge even over the auto-approve limit', async () => {
			// GIVEN a run auto-approving 0 paid cents but with enforcement off
			const researchId = await seedRun()
			// WHEN a paid call above that limit is charged
			const outcome = await chargeThenObserve(researchId, 0, false, [], {
				cents: 5,
				key: `key-${randomUUID()}`,
			})
			// THEN the per-run budget is the only gate — it still charges
			expect(outcome._tag).toBe('Success')
			expect(await spendRowCount(researchId)).toBe(1)
		})
	})
})
