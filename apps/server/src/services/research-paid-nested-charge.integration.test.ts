// Live-DB integration test for paid charges made while a request already has a
// database transaction open — the shape the `discover_contacts` tool runs in.
//
// Each purchase records itself in its own transaction. Several purchases run at
// once, and the database names a nested transaction after how deeply it is
// nested — so purchases started at the same depth all get the same name, and one
// of them undoing itself would undo the others' records too. A purchase that
// borrows the request's transaction also loses its record entirely if the
// request later fails, while the vendor has already charged for the call.
//
// Both leave the month's spending believing less was spent than really was,
// which raises the very ceiling it is there to hold.
//
// Prereq: `pnpm cli services up` — this suite's own globalSetup builds and
// migrates the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Budget, makeBudgetLayer } from '@batuda/research'

import { PgLive } from '../db/client'
import { detachFromTransaction } from '../middleware/org'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = `nested-org-${randomUUID()}`
// Its own company, with room to spare: this one is about a record surviving,
// not about the ceiling, so it must not inherit the other's spending.
const ROOMY_ORG = `nested-org-roomy-${randomUUID()}`
const CHARGE_CENTS = 5
const CONCURRENT = 4
// A ceiling only two of the four purchases fit under, so the other two refuse
// and undo themselves — which is the only moment a shared nested transaction
// takes its siblings' records down with it.
const CAP_CENTS = 10
const EXPECTED_ROWS = CAP_CENTS / CHARGE_CENTS

let pool: pg.Pool

// Charge several times at once from inside a transaction the caller already
// opened, the way an assistant tool call does.
const chargeInsideRequestTransaction = (
	userId: string,
	researchId: string,
	detached: boolean,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const charges = Effect.gen(function* () {
				const budget = yield* Budget
				yield* Effect.forEach(
					Array.from({ length: CONCURRENT }, (_, i) => i),
					attempt =>
						budget
							.chargePaid(
								'hunter-verify',
								CHARGE_CENTS,
								'discover_contacts',
								`${researchId}:verify-${attempt}`,
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
							paidBudgetCents: 10_000,
							autoApprovePaidCents: 10_000,
							autoApplyMinConfidence: null,
						} as never,
						defaultCapCents: 2000,
						systemCeiling: 10_000,
					}),
				),
			)
			yield* (
				detached ? charges.pipe(detachFromTransaction(sql)) : charges
			).pipe(sql.withTransaction)
		}).pipe(Effect.timeout('20 seconds'), Effect.orDie),
	)

const ledgerRows = async (userId: string): Promise<number> => {
	const r = await pool.query<{ n: string }>(
		`SELECT count(*)::text AS n FROM research_paid_spend WHERE user_id = $1`,
		[userId],
	)
	return Number(r.rows[0]?.n ?? -1)
}

const seedRun = async (org = ORG): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by)
		 VALUES ($1, 'nested charge', 'succeeded', 'nested-user') RETURNING id`,
		[org],
	)
	return r.rows[0]?.id ?? ''
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await pool.query(
		`INSERT INTO organization_research_policy (organization_id, paid_monthly_cap_cents)
		 VALUES ($1, $2), ($3, 10000)`,
		[ORG, CAP_CENTS, ROOMY_ORG],
	)
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM research_runs WHERE organization_id = ANY($1::text[])`,
		[[ORG, ROOMY_ORG]],
	)
	await pool.query(
		`DELETE FROM organization_research_policy WHERE organization_id = ANY($1::text[])`,
		[[ORG, ROOMY_ORG]],
	)
	await runtime.dispose()
	await pool.end()
})

describe('paid charges made while the caller holds a transaction', () => {
	describe('when several are made at once from their own transactions', () => {
		it('should let through only what fits and keep each record', async () => {
			// GIVEN a request that has already opened a transaction, and four
			// purchases about to be made at once inside it, only two of which fit
			// under the month's ceiling
			const userId = `nested-user-${randomUUID()}`
			const researchId = await seedRun()

			// WHEN each purchase records itself in a transaction of its own
			await chargeInsideRequestTransaction(userId, researchId, true)

			// THEN exactly the two that fit are on record. More would mean the
			// purchases never really took turns and the ceiling was passed; fewer
			// would mean a refused purchase took a successful one's record with it
			expect(await ledgerRows(userId)).toBe(EXPECTED_ROWS)
		}, 60_000)
	})

	describe('when the caller who opened the transaction never commits it', () => {
		it('should still keep the records of what was already bought', async () => {
			// GIVEN a request that opens a transaction and then fails
			const userId = `nested-user-${randomUUID()}`
			const researchId = await seedRun(ROOMY_ORG)

			// WHEN purchases are made and the request's transaction is rolled back
			await runtime
				.runPromise(
					Effect.gen(function* () {
						const sql = yield* SqlClient.SqlClient
						yield* Effect.gen(function* () {
							const budget = yield* Budget
							yield* budget
								.chargePaid(
									'hunter',
									CHARGE_CENTS,
									'discover_contacts',
									`${researchId}:enrich`,
								)
								.pipe(Effect.ignore)
							return yield* Effect.fail(new Error('request failed'))
						}).pipe(
							Effect.provide(
								makeBudgetLayer({
									organizationId: ROOMY_ORG,
									userId,
									researchId,
									policy: {
										budgetCents: 1000,
										paidBudgetCents: 10_000,
										autoApprovePaidCents: 10_000,
										autoApplyMinConfidence: null,
									} as never,
									defaultCapCents: 2000,
									systemCeiling: 10_000,
								}),
							),
							detachFromTransaction(sql),
							sql.withTransaction,
						)
					}),
				)
				.catch(() => undefined)

			// THEN the purchase is still on record — the vendor charged for it, so
			// the month has to count it whatever became of the request
			expect(await ledgerRows(userId)).toBe(1)
		}, 60_000)
	})
})
