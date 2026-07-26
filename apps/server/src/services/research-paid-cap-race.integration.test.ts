// Live-DB integration test for the monthly ceiling on what one person's
// research runs may spend on metered calls.
//
// The ceiling is only meaningful if it holds when several paid calls land at
// once, which is the normal case: a run fans out its contact lookups. Deciding
// and recording have to happen together, on one connection, or two calls read
// the same total, both believe there is room, and both charge — so this drives
// real concurrent charges against real Postgres rather than a stand-in.
//
// Deliberately small and time-boxed: a handful of charges against a disposable
// local database, under a hard deadline, so a locking regression fails in
// seconds instead of hanging the run.
//
// Prereq: `pnpm cli services up` — this suite's own globalSetup builds and
// migrates the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, ManagedRuntime } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Budget, makeBudgetLayer } from '@batuda/research'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = `cap-org-${randomUUID()}`

// Ten charges of 10c each are fired at a 30c ceiling, so exactly three fit.
const CHARGE_CENTS = 10
const CAP_CENTS = 30
const ATTEMPTS = 10

let pool: pg.Pool

const chargeConcurrently = (userId: string, researchId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const budget = yield* Budget
			yield* Effect.forEach(
				Array.from({ length: ATTEMPTS }, (_, i) => i),
				attempt =>
					budget
						.chargePaid(
							'hunter',
							CHARGE_CENTS,
							'discover_contacts',
							// A distinct key per attempt: this is about the ceiling, not
							// about a retry of one charge being recorded twice.
							`${researchId}:attempt-${attempt}`,
						)
						.pipe(Effect.ignore),
				{ concurrency: 'unbounded' },
			)
		}).pipe(
			Effect.provide(
				makeBudgetLayer({
					organizationId: ORG,
					userId,
					researchId,
					policy: {
						budgetCents: 1000,
						// High enough that this run's own purse never refuses first —
						// the monthly ceiling is what is under test.
						paidBudgetCents: 10_000,
						autoApprovePaidCents: 10_000,
						paidMonthlyCapCents: CAP_CENTS,
						autoApplyMinConfidence: null,
					} as never,
					systemCeiling: 10_000,
				}),
			),
			// A locking regression shows up as a deadlock, so bound it: this must
			// finish in seconds or fail, never hang the suite.
			Effect.timeout('20 seconds'),
			Effect.orDie,
		),
	)

const ledgerFor = async (
	userId: string,
): Promise<{ rows: number; cents: number }> => {
	const r = await pool.query<{ rows: string; cents: string }>(
		`SELECT count(*)::text AS rows, COALESCE(SUM(amount_cents), 0)::text AS cents
		 FROM research_paid_spend WHERE user_id = $1`,
		[userId],
	)
	return {
		rows: Number(r.rows[0]?.rows ?? -1),
		cents: Number(r.rows[0]?.cents ?? -1),
	}
}

const seedRun = async (): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by)
		 VALUES ($1, 'cap race', 'running', 'cap-user') RETURNING id`,
		[ORG],
	)
	return r.rows[0]?.id ?? ''
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	// research_paid_spend.research_id cascades from research_runs.
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await runtime.dispose()
	await pool.end()
})

describe("the monthly ceiling on a person's metered spend", () => {
	describe('when many paid calls charge it at the same time', () => {
		it('should let through only what fits under the ceiling', async () => {
			// GIVEN a person with a 30c monthly ceiling and a run about to make ten
			// 10c calls at once
			const userId = `cap-user-${randomUUID()}`
			const researchId = await seedRun()

			// WHEN they all charge together
			await chargeConcurrently(userId, researchId)

			// THEN exactly three were recorded and nothing was spent past the
			// ceiling — two calls both reading the same total would show up here as
			// a fourth row
			const ledger = await ledgerFor(userId)
			expect(ledger.rows).toBe(CAP_CENTS / CHARGE_CENTS)
			expect(ledger.cents).toBe(CAP_CENTS)
		}, 60_000)
	})

	describe('when the ceiling is already reached', () => {
		it('should record nothing further', async () => {
			// GIVEN a person whose earlier calls already filled the ceiling
			const userId = `cap-user-${randomUUID()}`
			const researchId = await seedRun()
			await chargeConcurrently(userId, researchId)

			// WHEN a later run tries again
			await chargeConcurrently(userId, await seedRun())

			// THEN the total is unchanged — the ceiling counts the month, not the run
			const ledger = await ledgerFor(userId)
			expect(ledger.cents).toBe(CAP_CENTS)
		}, 60_000)
	})
})
