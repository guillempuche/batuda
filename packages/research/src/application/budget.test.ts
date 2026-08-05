import { Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { describe, expect, it } from 'vitest'

import { ProviderError } from '../domain/errors'
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
	autoApplyMinConfidence: null,
})

// Stands in for the paid-spend ledger; its transaction wrapper simply runs what
// it is handed. `charge` decides what the real one would have answered: that the
// row landed, that it was a repeat of one already recorded, or that the write
// never finishes.
//
// Each of the four statements a charge makes gets its own answer, because they
// mean different things: the company's own ceiling, this month's total so far,
// and whether the row landed. Answering them all alike would let a test about
// the ceiling silently read the wrong number.
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
		readonly orgCapCents?: number
		readonly spentThisMonth?: number
	} = {},
) => {
	const ledgerWrite =
		options.charge ??
		Effect.yieldNow.pipe(Effect.as([{ id: 'spend-1' }] as const))
	const fakeSql = ((strings: ReadonlyArray<string>) => {
		const text = strings.join(' ')
		if (text.includes('organization_research_policy'))
			return Effect.succeed(
				options.orgCapCents === undefined
					? []
					: [{ paidMonthlyCapCents: options.orgCapCents }],
			)
		if (text.includes('SUM(amount_cents)'))
			return Effect.succeed([{ spent: options.spentThisMonth ?? 0 }])
		if (text.includes('pg_advisory_xact_lock')) return Effect.succeed([])
		return ledgerWrite
	}) as unknown as SqlClient.SqlClient
	Object.assign(fakeSql, {
		withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
	})
	return makeBudgetLayer({
		organizationId: 'org-1',
		userId: 'user-1',
		researchId: 'run-1',
		policy: new ResolvedPolicy({ ...POLICY, ...options.policy }),
		defaultCapCents: 2000,
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
						budget
							.chargePaid(
								'hunter',
								10,
								'discover_contacts',
								`key-${crypto.randomUUID()}`,
							)
							.pipe(
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
						yield* budget.chargePaid(
							'hunter',
							40,
							'discover_contacts',
							`key-${crypto.randomUUID()}`,
						)
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
						budget.chargePaid(
							'hunter',
							40,
							'discover_contacts',
							`key-${crypto.randomUUID()}`,
						),
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
							budget
								.chargePaid(
									'hunter',
									cents,
									'discover_contacts',
									`key-${crypto.randomUUID()}`,
								)
								.pipe(
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

describe('what a company may spend on paid calls in a month', () => {
	describe('when the company has set no figure of its own', () => {
		it('should allow up to the figure shipped in configuration', async () => {
			// GIVEN no row for this company, and 1990c already spent this month
			// against a shipped figure of 2000c
			// WHEN a 20c call is charged
			const outcome = await withBudget(
				budget =>
					budget
						.chargePaid('hunter', 20, 'discover_contacts', 'k1')
						.pipe(Effect.flip),
				{ spentThisMonth: 1990 },
			)

			// THEN it is refused, and says what the ceiling was
			expect(outcome._tag).toBe('MonthlyCapExceeded')
			expect((outcome as { capCents: number }).capCents).toBe(2000)
		})
	})

	describe('when the company has been given a larger figure', () => {
		it('should allow up to that figure instead', async () => {
			// GIVEN this company is allowed 5000c and has spent 1990c
			// WHEN the same 20c call is charged
			const paid = await withBudget(
				budget => budget.chargePaid('hunter', 20, 'discover_contacts', 'k1'),
				{ orgCapCents: 5000, spentThisMonth: 1990 },
			)

			// THEN it goes through — the company's own figure is what counts
			expect(paid).toBe(true)
		})
	})

	describe('when a company is given more than the system allows', () => {
		it('should still stop at the system ceiling', async () => {
			// GIVEN a company figure far above the system ceiling of 10000c, and
			// 9990c already spent
			// WHEN a 20c call is charged
			const outcome = await withBudget(
				budget =>
					budget
						.chargePaid('hunter', 20, 'discover_contacts', 'k1')
						.pipe(Effect.flip),
				{ orgCapCents: 999_999, spentThisMonth: 9990 },
			)

			// THEN the system ceiling is what refuses it, so one setting can never
			// authorise unlimited spending
			expect((outcome as { capCents: number }).capCents).toBe(10_000)
		})
	})
})

describe('paying for a vendor call that then fails', () => {
	describe('when the vendor call fails after the money was set aside', () => {
		it('should give the run its allowance back', async () => {
			// GIVEN a run with 100c of paid allowance
			// WHEN it pays 20c for a call and that call fails
			const left = await withBudget(budget =>
				budget
					.withPaidCharge(
						'hunter',
						20,
						'discover_contacts',
						'k1',
					)(() =>
						Effect.fail(
							new ProviderError({
								provider: 'hunter',
								message: 'upstream 503',
								recoverable: true,
							}),
						),
					)
					.pipe(
						Effect.ignore,
						Effect.andThen(budget.snapshot()),
						Effect.map(s => s.paidRemaining),
					),
			)

			// THEN the allowance is untouched, so the rest of the run still has the
			// room it would have had — it bought nothing
			expect(left).toBe(100)
		})
	})

	describe('when the vendor call succeeds', () => {
		it('should keep the money spent and hand back what was bought', async () => {
			// GIVEN the same run
			// WHEN it pays 20c for a call that answers
			const outcome = await withBudget(budget =>
				budget.withPaidCharge(
					'hunter',
					20,
					'discover_contacts',
					'k1',
				)(() => Effect.succeed('the answer')),
			)

			// THEN the answer comes back marked as bought, not as a replay
			expect(outcome).toStrictEqual({ _tag: 'bought', value: 'the answer' })
		})
	})

	describe('when the same call was already paid for in this run', () => {
		it('should not ask the vendor again', async () => {
			// GIVEN a ledger that reports this call as one already recorded
			let asked = 0
			const outcome = await withBudget(
				budget =>
					budget.withPaidCharge(
						'hunter',
						20,
						'discover_contacts',
						'k1',
					)(() => {
						asked += 1
						return Effect.succeed('second')
					}),
				{ charge: Effect.succeed([]) },
			)

			// THEN the vendor is never reached and the caller is told why, so it
			// uses the answer it already has rather than buying it twice
			expect(asked).toBe(0)
			expect(outcome).toStrictEqual({ _tag: 'already_charged' })
		})
	})
})
