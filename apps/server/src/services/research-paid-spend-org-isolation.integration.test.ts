// Live-DB integration test for the research_paid_spend upsert, driven through
// the real Budget layer (not hand-copied SQL) so a future regression here
// fails loudly again.
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

const ORG_A = `ps-orgA-${randomUUID()}`
const ORG_B = `ps-orgB-${randomUUID()}`
const USER = `ps-u1-${randomUUID()}`
// Isolated from USER so its monthly spend total starts at zero regardless
// of what other cases in this file have already charged this month.
const MONTHLY_CAP_USER = `ps-cap-${randomUUID()}`

// Generous enough that the monthly cap never rejects a 50-cent test charge.
const SYSTEM_DEFAULTS = {
	budgetCents: 100_000,
	paidBudgetCents: 100_000,
	autoApprovePaidCents: 100_000,
	paidMonthlyCapCents: 100_000,
	hardCeiling: 100_000,
}

// Deliberately tight: two 50-cent charges exhaust it, so a same-key retry
// that double-counted its in-memory remaining budget would wrongly reject
// the run's third, distinct charge.
const TIGHT_RUN_BUDGET_DEFAULTS = {
	...SYSTEM_DEFAULTS,
	paidBudgetCents: 100,
}

// Below any single test charge, so the very first charge exceeds it.
const LOW_MONTHLY_CAP_DEFAULTS = {
	...SYSTEM_DEFAULTS,
	paidMonthlyCapCents: 10,
}

let pool: pg.Pool

const seedRun = async (orgId: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by)
		 VALUES ($1, 'ps query', 'succeeded', $2) RETURNING id`,
		[orgId, USER],
	)
	return r.rows[0]?.id ?? ''
}

// Drives the same Budget.chargePaid path discover_contacts uses, so a
// regression in the underlying ON CONFLICT target fails this test, not just
// a live MCP call.
const charge = (
	organizationId: string,
	researchId: string,
	idempotencyKey: string,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const policy = yield* resolvePolicy({
				sql,
				userId: USER,
				systemDefaults: SYSTEM_DEFAULTS,
			})
			const budgetLayer = makeBudgetLayer({
				organizationId,
				userId: USER,
				researchId,
				policy,
				systemCeiling: SYSTEM_DEFAULTS.hardCeiling,
			}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

			const chargeEffect = Effect.gen(function* () {
				const budget = yield* Budget
				yield* budget.chargePaid('test-provider', 50, idempotencyKey)
			})

			yield* chargeEffect.pipe(Effect.provide(budgetLayer))
		}),
	)

// Drives zero or more setup charges against ONE Budget instance (one
// shared in-memory remaining-budget counter), then captures the outcome of
// one final charge via Effect.result — a BudgetExceeded/MonthlyCapExceeded
// failure resolves as a value instead of rejecting; only an unexpected
// defect still rejects the call.
const chargeThenObserve = (
	organizationId: string,
	researchId: string,
	userId: string,
	systemDefaults: typeof SYSTEM_DEFAULTS,
	setupCharges: ReadonlyArray<{ readonly cents: number; readonly key: string }>,
	observedCharge: { readonly cents: number; readonly key: string },
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const policy = yield* resolvePolicy({
				sql,
				userId,
				systemDefaults,
			})
			const budgetLayer = makeBudgetLayer({
				organizationId,
				userId,
				researchId,
				policy,
				systemCeiling: systemDefaults.hardCeiling,
			}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

			return yield* Effect.gen(function* () {
				const budget = yield* Budget
				for (const { cents, key } of setupCharges) {
					yield* budget.chargePaid('test-provider', cents, key)
				}
				return yield* Effect.result(
					budget.chargePaid(
						'test-provider',
						observedCharge.cents,
						observedCharge.key,
					),
				)
			}).pipe(Effect.provide(budgetLayer))
		}),
	)

// Mirrors production's RLS posture: SET LOCAL ROLE app_user + the
// app.current_org_id GUC, inside a transaction that always rolls back so
// the probe write never actually persists.
const asAppUser = async <T>(
	orgId: string,
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		await client.query('SET LOCAL ROLE app_user')
		await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
			orgId,
		])
		return await fn(client)
	} finally {
		await client.query('ROLLBACK').catch(() => {})
		client.release()
	}
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	// research_paid_spend.research_id cascades from research_runs, so
	// deleting the runs alone clears both tables.
	await pool.query(
		`DELETE FROM research_runs WHERE organization_id = ANY($1::text[])`,
		[[ORG_A, ORG_B]],
	)
	await runtime.dispose()
	await pool.end()
})

describe('recording paid research spend', () => {
	describe('when a paid provider call is charged', () => {
		it('should record one spend row for the charging org, without crashing', async () => {
			// GIVEN a research run anchored to an org
			const researchId = await seedRun(ORG_A)
			// WHEN a paid call is charged
			await charge(ORG_A, researchId, `key-${randomUUID()}`)
			// THEN it records exactly one spend row for that org
			const rows = await pool.query<{ organization_id: string }>(
				`SELECT organization_id FROM research_paid_spend WHERE research_id = $1`,
				[researchId],
			)
			expect(rows.rows).toHaveLength(1)
			expect(rows.rows[0]?.organization_id).toBe(ORG_A)
		})
	})

	describe('when the same idempotency key is charged twice', () => {
		it('should record only one spend row', async () => {
			// GIVEN a research run and a fixed idempotency key
			const researchId = await seedRun(ORG_A)
			const key = `key-${randomUUID()}`
			// WHEN the same charge is retried (e.g. after a network timeout)
			await charge(ORG_A, researchId, key)
			await charge(ORG_A, researchId, key)
			// THEN the retry is a no-op, not a duplicate row
			const rows = await pool.query(
				`SELECT id FROM research_paid_spend WHERE research_id = $1 AND idempotency_key = $2`,
				[researchId, key],
			)
			expect(rows.rows).toHaveLength(1)
		})
	})

	describe('when two organizations charge under the same idempotency key', () => {
		it('should record a separate row per organization, not collide', async () => {
			// GIVEN two orgs, each with their own research run
			const runA = await seedRun(ORG_A)
			const runB = await seedRun(ORG_B)
			const sharedKey = `key-${randomUUID()}`
			// WHEN both charge under the identical idempotency key string
			await charge(ORG_A, runA, sharedKey)
			await charge(ORG_B, runB, sharedKey)
			// THEN both rows coexist — the per-org key keeps them isolated
			const rows = await pool.query<{ organization_id: string }>(
				`SELECT organization_id FROM research_paid_spend WHERE idempotency_key = $1 ORDER BY organization_id`,
				[sharedKey],
			)
			expect(rows.rows.map(r => r.organization_id)).toEqual(
				[ORG_A, ORG_B].sort(),
			)
		})
	})

	describe('when the same idempotency key is charged twice within one run', () => {
		it('should count the real spend once against the run budget', async () => {
			// GIVEN a run with just enough paid budget for two 50-cent charges
			const researchId = await seedRun(ORG_A)
			const key = `key-${randomUUID()}`
			// WHEN the same charge is retried, then a distinct charge follows
			const outcome = await chargeThenObserve(
				ORG_A,
				researchId,
				USER,
				TIGHT_RUN_BUDGET_DEFAULTS,
				[
					{ cents: 50, key },
					{ cents: 50, key }, // retry — DB no-op, must not double-count
				],
				{ cents: 50, key: `key-${randomUUID()}` },
			)
			// THEN the run still has budget for the second real charge — the
			// retry didn't count against it twice
			expect(outcome._tag).toBe('Success')
		})
	})

	describe('when a charge exceeds the monthly cap', () => {
		it('should fail with a typed error instead of crashing', async () => {
			// GIVEN a research run and a cap far below one charge
			const researchId = await seedRun(ORG_A)
			// WHEN the charge is attempted
			const outcome = await chargeThenObserve(
				ORG_A,
				researchId,
				MONTHLY_CAP_USER,
				LOW_MONTHLY_CAP_DEFAULTS,
				[],
				{ cents: 50, key: `key-${randomUUID()}` },
			)
			// THEN it resolves as a typed failure the caller can catch and
			// degrade on, not an unhandled crash
			expect(outcome._tag).toBe('Failure')
			if (outcome._tag === 'Failure') {
				expect(outcome.failure._tag).toBe('MonthlyCapExceeded')
			}
		})
	})

	describe('when a write targets an organization other than the session scope', () => {
		it('should be rejected by row-level security', async () => {
			// GIVEN a research run anchored to org A
			const researchId = await seedRun(ORG_A)
			// WHEN the session is scoped to org A but the row claims org B
			// THEN Postgres rejects the write under the org_isolation_research_paid_spend policy
			await expect(
				asAppUser(ORG_A, client =>
					client.query(
						`INSERT INTO research_paid_spend (
							organization_id, research_id, user_id, provider, tool, idempotency_key,
							amount_cents, args, auto_approved, at
						) VALUES ($1, $2, $3, 'test-provider', 'paid', $4, 50, '{}'::jsonb, true, now())`,
						[ORG_B, researchId, USER, `key-${randomUUID()}`],
					),
				),
			).rejects.toThrow(/row-level security/i)
		})
	})
})
