import { Effect, Layer, Ref } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { BudgetExceeded, MonthlyCapExceeded } from '../domain/errors'
import type { BudgetSnapshot, ResolvedPolicy } from '../domain/types'
import { Budget } from './ports'

// ── Monthly paid spend: check-and-debit serialized per user ──

interface ChargeWithinCapInput {
	readonly sql: SqlClient.SqlClient
	readonly userId: string
	readonly cents: number
	readonly researchId: string
	readonly provider: string
	readonly tool: string
	readonly idempotencyKey: string
	readonly args: unknown
	readonly autoApproved: boolean
	readonly userCap: number
	readonly systemCeiling: number
}

const chargeWithinCap = (input: ChargeWithinCapInput) =>
	Effect.gen(function* () {
		const { sql } = input
		const cap = Math.min(input.userCap, input.systemCeiling)

		// Single transaction: advisory lock → check → insert.
		// pg_advisory_xact_lock serializes concurrent fibers for the same user.
		yield* sql`SELECT pg_advisory_xact_lock(hashtext('research_monthly_cap:' || ${input.userId}))`

		const rows = yield* sql<{ spent: number }>`
			SELECT COALESCE(SUM(amount_cents), 0)::int AS spent
			FROM research_paid_spend
			WHERE user_id = ${input.userId}
			  AND at >= date_trunc('month', now())
		`
		const spent = rows[0]?.spent ?? 0

		if (spent + input.cents > cap) {
			return yield* new MonthlyCapExceeded({
				capCents: cap,
				spentCents: spent,
			})
		}

		// Idempotency: UNIQUE on idempotency_key. If this is a retry after
		// a network timeout, the INSERT is a conflict no-op and the budget
		// accounting stays correct.
		yield* sql`
			INSERT INTO research_paid_spend (
				research_id, user_id, provider, tool, idempotency_key,
				amount_cents, args, auto_approved, at
			) VALUES (
				${input.researchId}, ${input.userId}, ${input.provider},
				${input.tool}, ${input.idempotencyKey},
				${input.cents}, ${JSON.stringify(input.args)},
				${input.autoApproved}, now()
			) ON CONFLICT (idempotency_key) DO NOTHING
		`
	}).pipe(Effect.orDie)

// ── Budget Layer factory ──

export interface BudgetConfig {
	readonly userId: string
	readonly researchId: string
	readonly policy: ResolvedPolicy
	readonly systemCeiling: number
}

export const makeBudgetLayer = (config: BudgetConfig) =>
	Layer.effect(
		Budget,
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const cheapRef = yield* Ref.make({
				budget: config.policy.budgetCents,
				spent: 0,
				remaining: config.policy.budgetCents,
			})
			const paidRef = yield* Ref.make({
				budget: config.policy.paidBudgetCents,
				spent: 0,
				remaining: config.policy.paidBudgetCents,
			})

			return Budget.of({
				init: (cheapCents: number, paidCents: number) =>
					Effect.gen(function* () {
						yield* Ref.set(cheapRef, {
							budget: cheapCents,
							spent: 0,
							remaining: cheapCents,
						})
						yield* Ref.set(paidRef, {
							budget: paidCents,
							spent: 0,
							remaining: paidCents,
						})
					}),

				chargeCheap: (provider: string, cents: number) =>
					Effect.gen(function* () {
						const state = yield* Ref.get(cheapRef)
						if (state.remaining < cents) {
							return yield* new BudgetExceeded({
								tier: 'cheap',
								needed: cents,
								remaining: state.remaining,
							})
						}
						yield* Ref.update(cheapRef, s => ({
							...s,
							spent: s.spent + cents,
							remaining: s.remaining - cents,
						}))
					}).pipe(
						Effect.tap(() =>
							Effect.logDebug('budget.chargeCheap').pipe(
								Effect.annotateLogs({ provider, cents }),
							),
						),
					),

				chargePaid: (
					provider: string,
					cents: number,
					idempotencyKey?: string,
				) =>
					Effect.gen(function* () {
						const state = yield* Ref.get(paidRef)
						if (state.remaining < cents) {
							return yield* new BudgetExceeded({
								tier: 'paid-run',
								needed: cents,
								remaining: state.remaining,
							})
						}

						yield* chargeWithinCap({
							sql,
							userId: config.userId,
							cents,
							researchId: config.researchId,
							provider,
							tool: 'paid',
							idempotencyKey:
								idempotencyKey ??
								`${config.researchId}:${provider}:${Date.now()}`,
							args: {},
							autoApproved: true,
							userCap: config.policy.paidMonthlyCapCents,
							systemCeiling: config.systemCeiling,
						})

						yield* Ref.update(paidRef, s => ({
							...s,
							spent: s.spent + cents,
							remaining: s.remaining - cents,
						}))
					}).pipe(
						Effect.tap(() =>
							Effect.logDebug('budget.chargePaid').pipe(
								Effect.annotateLogs({ provider, cents }),
							),
						),
					),

				snapshot: () =>
					Effect.gen(function* () {
						const cheap = yield* Ref.get(cheapRef)
						const paid = yield* Ref.get(paidRef)
						return {
							cheapBudget: cheap.budget,
							cheapSpent: cheap.spent,
							cheapRemaining: cheap.remaining,
							paidBudget: paid.budget,
							paidSpent: paid.spent,
							paidRemaining: paid.remaining,
						} satisfies BudgetSnapshot
					}),
			})
		}),
	)
