// Live-DB integration test for the run-cost rollup: stampRunCostFromLedger
// writes paid_cost_cents from the research_paid_spend ledger (the fix for runs
// that always reported $0) and cost_cents from the caller's cheap-tier tally.
// Driven through the real exported helper, not hand-copied SQL, and run as the
// DB owner (no SET LOCAL ROLE app_user) to mirror the research run fibre's
// RLS-bypassing connection.
//
// Prereq: `pnpm cli services up` — this suite's own globalSetup builds and
// migrates the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { stampRunCostFromLedger } from '@batuda/research'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = `cost-org-${randomUUID()}`
const USER = `cost-u1-${randomUUID()}`

let pool: pg.Pool

const seedRun = async (): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by)
		 VALUES ($1, 'cost query', 'succeeded', $2) RETURNING id`,
		[ORG, USER],
	)
	return r.rows[0]?.id ?? ''
}

// One paid-spend ledger row for a run, the same shape Budget.chargePaid writes.
const seedPaidSpend = async (
	researchId: string,
	cents: number,
): Promise<void> => {
	await pool.query(
		`INSERT INTO research_paid_spend (
			organization_id, research_id, user_id, provider, tool, idempotency_key,
			amount_cents, args, auto_approved, at
		) VALUES ($1, $2, $3, 'hunter', 'hunter_enrich', $4, $5, '{}'::jsonb, true, now())`,
		[ORG, researchId, USER, `key-${randomUUID()}`, cents],
	)
}

const stamp = (researchId: string, cheapCents: number): Promise<void> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* stampRunCostFromLedger(sql, researchId, cheapCents)
		}),
	)

const readCost = async (
	researchId: string,
): Promise<{ costCents: number; paidCostCents: number }> => {
	const r = await pool.query<{ cost_cents: number; paid_cost_cents: number }>(
		`SELECT cost_cents, paid_cost_cents FROM research_runs WHERE id = $1`,
		[researchId],
	)
	const row = r.rows[0]
	return {
		costCents: row?.cost_cents ?? -1,
		paidCostCents: row?.paid_cost_cents ?? -1,
	}
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

describe('stamping a research run cost from the paid-spend ledger', () => {
	describe('when the run charged several paid rows', () => {
		it('should set paid_cost_cents to their sum and cost_cents to the cheap tally', async () => {
			// GIVEN a run whose ledger holds a 5¢ enrich + six 1¢ verifies (11¢)
			const researchId = await seedRun()
			await seedPaidSpend(researchId, 5)
			for (let i = 0; i < 6; i += 1) await seedPaidSpend(researchId, 1)

			// WHEN the run is finalized with a 30¢ cheap-tier tally
			await stamp(researchId, 30)

			// THEN paid_cost_cents equals the ledger sum and cost_cents the tally
			const { costCents, paidCostCents } = await readCost(researchId)
			expect(paidCostCents).toBe(11)
			expect(costCents).toBe(30)
		})
	})

	describe('when the run charged nothing', () => {
		it('should leave paid_cost_cents at 0 while still recording the cheap tally', async () => {
			// GIVEN a run with no paid-spend rows
			const researchId = await seedRun()

			// WHEN it is finalized with a 7¢ cheap-tier tally
			await stamp(researchId, 7)

			// THEN the paid column is 0 and the cheap column carries the tally
			const { costCents, paidCostCents } = await readCost(researchId)
			expect(paidCostCents).toBe(0)
			expect(costCents).toBe(7)
		})
	})

	describe('when the same run is stamped twice', () => {
		it('should be idempotent — a re-stamp reports the same totals', async () => {
			// GIVEN a run with one 4¢ ledger row, already stamped once
			const researchId = await seedRun()
			await seedPaidSpend(researchId, 4)
			await stamp(researchId, 12)

			// WHEN the finalize path stamps it again (e.g. a resumed run)
			await stamp(researchId, 12)

			// THEN the totals are unchanged — the ledger sum is stable
			const { costCents, paidCostCents } = await readCost(researchId)
			expect(paidCostCents).toBe(4)
			expect(costCents).toBe(12)
		})
	})
})
