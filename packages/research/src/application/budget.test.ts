import { Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { describe, expect, it } from 'vitest'

import { ResolvedPolicy } from '../domain/types'
import { makeBudgetLayer } from './budget'
import { Budget } from './ports'

// A research run spends from two purses: a cheap one for searches and page
// fetches, and a paid one for the metered lookups that bill per call. Both are
// drawn on by several tool calls at once, so these cover one thing above all:
// two calls can never both spend the same money.

const POLICY = new ResolvedPolicy({
	budgetCents: 100,
	paidBudgetCents: 100,
	autoApprovePaidCents: 100,
	paidMonthlyCapCents: 10_000,
	autoApplyMinConfidence: null,
})

// Stands in for the paid-spend ledger; its transaction wrapper simply runs what
// it is handed. `charge` decides what the real one would have answered: that the
// row landed, that it was a repeat of one already recorded, or that the write
// never finishes.
//
// The default write pauses before answering, the way a real database call does.
// That pause is the whole point: it is the window in which a second paid call
// can run, so a purse that decided and deducted in two steps would let both of
// them spend the same money.
const budgetLayer = (
	options: {
		readonly charge?: Effect.Effect<ReadonlyArray<{ id: string }>, never, never>
		readonly enforceAutoApprove?: boolean
		readonly policy?: Partial<ResolvedPolicy>
	} = {},
) => {
	const ledgerWrite =
		options.charge ??
		Effect.yieldNow.pipe(Effect.as([{ id: 'spend-1' }] as const))
	const fakeSql = ((..._args: ReadonlyArray<unknown>) =>
		ledgerWrite) as unknown as SqlClient.SqlClient
	Object.assign(fakeSql, {
		withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
	})
	return makeBudgetLayer({
		organizationId: 'org-1',
		userId: 'user-1',
		researchId: 'run-1',
		policy: new ResolvedPolicy({ ...POLICY, ...options.policy }),
		systemCeiling: 10_000,
		...(options.enforceAutoApprove !== undefined
			? { enforceAutoApprove: options.enforceAutoApprove }
			: {}),
	}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(fakeSql)))
}

const withBudget = <A, E>(
	body: (budget: Budget['Service']) => Effect.Effect<A, E, never>,
	options?: Parameters<typeof budgetLayer>[0],
): Promise<A> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const budget = yield* Budget
			return yield* body(budget)
		}).pipe(Effect.provide(budgetLayer(options)), Effect.orDie),
	)

describe('the cheap purse', () => {
	describe('when far more tool calls charge it than it can fund', () => {
		it('should fund exactly as many as it holds, never one more', async () => {
			// GIVEN a purse holding 100
			// WHEN 200 tool calls each charge 1 against it at once
			const result = await withBudget(budget =>
				Effect.forEach(
					Array.from({ length: 200 }),
					() =>
						budget.chargeCheap('search', 1).pipe(
							Effect.as('funded' as const),
							Effect.catchTag('BudgetExceeded', () =>
								Effect.succeed('refused' as const),
							),
						),
					{ concurrency: 'unbounded' },
				).pipe(
					Effect.flatMap(outcomes =>
						budget
							.snapshot()
							.pipe(Effect.map(snapshot => ({ outcomes, snapshot }))),
					),
				),
			)

			// THEN exactly the purse's worth was funded and nothing was overspent
			const funded = result.outcomes.filter(o => o === 'funded').length
			expect(funded).toBe(100)
			expect(result.snapshot.cheapSpent).toBe(100)
			expect(result.snapshot.cheapRemaining).toBe(0)
		})
	})

	describe('when a charge is refused', () => {
		it('should report what is actually left and take nothing', async () => {
			// GIVEN a purse already drawn down to 2
			const snapshot = await withBudget(budget =>
				Effect.gen(function* () {
					yield* budget.chargeCheap('search', 98)

					// WHEN a call asks for more than the remainder
					const refusal = yield* budget
						.chargeCheap('scrape', 5)
						.pipe(Effect.flip)

					// THEN it is told what remains, and the remainder is untouched
					expect(refusal.remaining).toBe(2)
					expect(refusal.needed).toBe(5)
					return yield* budget.snapshot()
				}),
			)
			expect(snapshot.cheapSpent).toBe(98)
		})
	})
})

describe('the paid purse', () => {
	describe('when more paid calls run at once than it can fund', () => {
		it('should fund exactly as many as it holds', async () => {
			// GIVEN a purse holding 100
			// WHEN 20 calls each billing 10 charge it at once
			const result = await withBudget(budget =>
				Effect.forEach(
					Array.from({ length: 20 }),
					() =>
						budget.chargePaid('hunter', 10, 'discover_contacts').pipe(
							Effect.as('funded' as const),
							Effect.catch(() => Effect.succeed('refused' as const)),
						),
					{ concurrency: 'unbounded' },
				).pipe(
					Effect.flatMap(outcomes =>
						budget
							.snapshot()
							.pipe(Effect.map(snapshot => ({ outcomes, snapshot }))),
					),
				),
			)

			// THEN only ten were funded and the purse is exactly empty
			expect(result.outcomes.filter(o => o === 'funded').length).toBe(10)
			expect(result.snapshot.paidSpent).toBe(100)
		})
	})

	describe('when the ledger already holds the same charge', () => {
		it('should give the money back rather than count it twice', async () => {
			// GIVEN a ledger that reports the row as already recorded
			const snapshot = await withBudget(
				budget =>
					Effect.gen(function* () {
						// WHEN a charge is made against it
						yield* budget.chargePaid('hunter', 40, 'discover_contacts')
						return yield* budget.snapshot()
					}),
				{ charge: Effect.succeed([]) },
			)

			// THEN the run's purse is untouched — the real charge was counted once
			expect(snapshot.paidSpent).toBe(0)
			expect(snapshot.paidRemaining).toBe(100)
		})
	})

	describe('when the run is cancelled mid-charge', () => {
		it('should give the reserved money back', async () => {
			// GIVEN a ledger write that never finishes
			const snapshot = await Effect.runPromise(
				Effect.gen(function* () {
					const budget = yield* Budget
					const fiber = yield* Effect.forkChild(
						budget.chargePaid('hunter', 40, 'discover_contacts'),
					)
					yield* Effect.yieldNow

					// WHEN the run is cancelled while the charge is in flight
					yield* Fiber.interrupt(fiber)

					// THEN nothing stays reserved against the run
					return yield* budget.snapshot()
				}).pipe(Effect.provide(budgetLayer({ charge: Effect.never }))),
			)
			expect(snapshot.paidSpent).toBe(0)
			expect(snapshot.paidRemaining).toBe(100)
		})
	})

	describe('when two calls straddle the approval limit', () => {
		it('should let at most one through', async () => {
			// GIVEN a run with money to spare but a 100 limit on what it may spend
			// without asking
			// WHEN two calls billing 60 each charge it at once
			const result = await withBudget(
				budget =>
					Effect.forEach(
						[60, 60],
						cents =>
							budget.chargePaid('hunter', cents, 'discover_contacts').pipe(
								Effect.as('charged' as const),
								Effect.catchTag('ApprovalRequired', () =>
									Effect.succeed('needs approval' as const),
								),
								Effect.catch(() => Effect.succeed('refused' as const)),
							),
						{ concurrency: 'unbounded' },
					),
				{
					enforceAutoApprove: true,
					policy: { paidBudgetCents: 1000, autoApprovePaidCents: 100 },
				},
			)

			// THEN the second is held for approval instead of slipping past the limit
			expect(result.filter(o => o === 'charged').length).toBe(1)
			expect(result).toContain('needs approval')
		})
	})
})
