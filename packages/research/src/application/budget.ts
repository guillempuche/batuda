import { Effect, Exit, Layer, Ref } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	ApprovalRequired,
	BudgetExceeded,
	MonthlyCapExceeded,
} from '../domain/errors'
import type { BudgetSnapshot, ResolvedPolicy } from '../domain/types'
import { Budget } from './ports'

// ── Monthly paid spend: check-and-debit serialized per organization ──

interface ChargeWithinCapInput {
	readonly sql: SqlClient.SqlClient
	readonly organizationId: string
	readonly userId: string
	readonly cents: number
	readonly researchId: string
	readonly provider: string
	readonly tool: string
	readonly idempotencyKey: string
	readonly args: unknown
	readonly autoApproved: boolean
	// What a company may spend on paid calls this month when it has set no
	// figure of its own.
	readonly defaultCapCents: number
	readonly systemCeiling: number
}

const chargeWithinCap = (input: ChargeWithinCapInput) =>
	Effect.gen(function* () {
		const { sql } = input

		// The lock, the sum and the insert are one transaction: a lock lasts only as
		// long as the transaction holding it, and separate statements can each land
		// on a different connection from the pool — so without one wrapping all
		// three, two charges for the same company could both read the same monthly
		// total and both go through, past the ceiling. Callers must not already
		// hold a transaction of their own, or the charges share it and stop taking
		// turns.
		yield* sql`SELECT pg_advisory_xact_lock(hashtext('research_monthly_cap:' || ${input.organizationId}))`

		// The company's own ceiling when it has set one, still bounded by the
		// system ceiling so one setting cannot authorise unlimited spending.
		// Read inside the lock so a change lands on the next charge.
		const capRows = yield* sql<{ paidMonthlyCapCents: number }>`
			SELECT paid_monthly_cap_cents
			FROM organization_research_policy
			WHERE organization_id = ${input.organizationId}
			LIMIT 1
		`
		const cap = Math.min(
			capRows[0]?.paidMonthlyCapCents ?? input.defaultCapCents,
			input.systemCeiling,
		)

		const rows = yield* sql<{ spent: number }>`
			SELECT COALESCE(SUM(amount_cents), 0)::int AS spent
			FROM research_paid_spend
			WHERE organization_id = ${input.organizationId}
			  AND at >= date_trunc('month', now())
		`
		const spent = rows[0]?.spent ?? 0

		if (spent + input.cents > cap) {
			return yield* new MonthlyCapExceeded({
				capCents: cap,
				spentCents: spent,
			})
		}

		// Idempotency: UNIQUE on (organization_id, idempotency_key) — the same
		// key is safe to reuse across orgs. If this is a retry after a network
		// timeout, the INSERT is a conflict no-op; the caller uses the
		// returned row to know whether to count this charge again.
		const inserted = yield* sql`
			INSERT INTO research_paid_spend (
				organization_id, research_id, user_id, provider, tool, idempotency_key,
				amount_cents, args, auto_approved, at
			) VALUES (
				${input.organizationId}, ${input.researchId}, ${input.userId}, ${input.provider},
				${input.tool}, ${input.idempotencyKey},
				${input.cents}, ${JSON.stringify(input.args)},
				${input.autoApproved}, now()
			) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
			RETURNING id
		`

		return inserted.length > 0
		// Only unexpected DB failures become defects here — MonthlyCapExceeded
		// above must stay a typed error so callers can catch and degrade on it.
	}).pipe(input.sql.withTransaction, Effect.catchTag('SqlError', Effect.die))

/**
 * What is left of a company's monthly allowance for paid vendor calls.
 *
 * Reads the same figures a charge does, so anything quoting a cost up front
 * quotes what a charge would really allow rather than a ceiling the month has
 * already used up.
 */
export const monthlyRemainingCents = (
	sql: SqlClient.SqlClient,
	input: {
		readonly organizationId: string
		readonly defaultCapCents: number
		readonly systemCeiling: number
	},
) =>
	Effect.gen(function* () {
		const capRows = yield* sql<{ paidMonthlyCapCents: number }>`
			SELECT paid_monthly_cap_cents
			FROM organization_research_policy
			WHERE organization_id = ${input.organizationId}
			LIMIT 1
		`
		const cap = Math.min(
			capRows[0]?.paidMonthlyCapCents ?? input.defaultCapCents,
			input.systemCeiling,
		)
		const spentRows = yield* sql<{ spent: number }>`
			SELECT COALESCE(SUM(amount_cents), 0)::int AS spent
			FROM research_paid_spend
			WHERE organization_id = ${input.organizationId}
			  AND at >= date_trunc('month', now())
		`
		return Math.max(0, cap - (spentRows[0]?.spent ?? 0))
	}).pipe(Effect.catchTag('SqlError', Effect.die))

// One tier's running total: what it was given, what it has spent, what is left.
interface TierState {
	readonly budget: number
	readonly spent: number
	readonly remaining: number
}

// The outcome of trying to take an amount off the cheap tier, decided in the
// same step that takes it: whether the money was set aside, and what was left at
// that moment — the figure a refusal reports back.
interface CheapCharge {
	readonly ok: boolean
	readonly remaining: number
}

// Why a paid charge was allowed or refused, decided in one step: the run is out
// of money, the charge needs a person's approval first, or the money is set
// aside and the vendor can be billed.
type PaidReservation =
	| { readonly _tag: 'exceeded'; readonly remaining: number }
	| { readonly _tag: 'approval' }
	| { readonly _tag: 'reserved' }

// ── Budget Layer factory ──

export interface BudgetConfig {
	readonly organizationId: string
	readonly userId: string
	readonly researchId: string
	readonly policy: ResolvedPolicy
	// What the company may spend this month when it has set no figure of its own.
	readonly defaultCapCents: number
	readonly systemCeiling: number
	// When true, a paid charge that would push this run's paid spend past the
	// caller's auto-approve limit is refused with ApprovalRequired instead of
	// charged — so an agent tool call above the limit surfaces an approval gate
	// rather than spending silently. Off by default (the per-run paid budget is
	// the only ceiling): set it on the in-run agent budget, but not on the
	// standalone tool (which gates interactively) or a follow-up run that is
	// executing an already-approved paid action.
	readonly enforceAutoApprove?: boolean
}

export const makeBudgetLayer = (config: BudgetConfig) =>
	Layer.effect(
		Budget,
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const cheapRef = yield* Ref.make<TierState>({
				budget: config.policy.budgetCents,
				spent: 0,
				remaining: config.policy.budgetCents,
			})
			const paidRef = yield* Ref.make<TierState>({
				budget: config.policy.paidBudgetCents,
				spent: 0,
				remaining: config.policy.paidBudgetCents,
			})

			// Give this run back the room it set aside for a call that did not
			// happen. This is the run's own allowance — how much more work it may
			// do — and is not the same thing as the record of money that may have
			// left the building, which lives in the paid-spend ledger and is left
			// alone: the vendor may well have billed for a call that failed on the
			// way back, and a run's allowance is not the place to guess about that.
			const releaseRunAllowance = (cents: number) =>
				Ref.update(paidRef, s => ({
					...s,
					spent: s.spent - cents,
					remaining: s.remaining + cents,
				}))

			// Named rather than written straight into the service object, so
			// withPaidCharge below can pay through exactly the same path instead of
			// keeping a second copy of the rules.
			const chargePaidImpl = (
				provider: string,
				cents: number,
				tool: string,
				idempotencyKey: string,
			) =>
				Effect.gen(function* () {
					// Set the money aside in one indivisible step that also decides both
					// refusals. Several paid tool calls can run at once, so deciding and
					// then deducting as two steps lets two of them clear the same limit
					// and both spend past it — which holds for the approval limit too.
					//
					// Stopping at the auto-approve limit hands back an approval gate the
					// agent surfaces as a pending paid action for the user to approve,
					// rather than charging. Only when enforced (the in-run agent
					// budget) — the standalone tool gates interactively and an approved
					// follow-up must charge.
					const reservation = yield* Ref.modify(
						paidRef,
						(s): readonly [PaidReservation, TierState] => {
							if (s.remaining < cents)
								return [
									{ _tag: 'exceeded' as const, remaining: s.remaining },
									s,
								]
							if (
								config.enforceAutoApprove &&
								s.spent + cents > config.policy.autoApprovePaidCents
							)
								return [{ _tag: 'approval' as const }, s]
							return [
								{ _tag: 'reserved' as const },
								{
									...s,
									spent: s.spent + cents,
									remaining: s.remaining - cents,
								},
							]
						},
					)
					if (reservation._tag === 'exceeded')
						return yield* new BudgetExceeded({
							tier: 'paid-run',
							needed: cents,
							remaining: reservation.remaining,
						})
					if (reservation._tag === 'approval')
						return yield* new ApprovalRequired({
							tool,
							estimatedCents: cents,
						})

					// Hand the money back when the charge does not land: the cap refused
					// it, the database failed, or the run was cancelled mid-charge — an
					// interrupted charge must not leave the run looking as if it spent.
					const release = releaseRunAllowance(cents)

					const charged = yield* chargeWithinCap({
						sql,
						organizationId: config.organizationId,
						userId: config.userId,
						cents,
						researchId: config.researchId,
						provider,
						// The calling tool's name, so a spend breakdown by tool is real.
						tool,
						idempotencyKey,
						args: {},
						autoApproved: true,
						defaultCapCents: config.defaultCapCents,
						systemCeiling: config.systemCeiling,
					}).pipe(
						Effect.onExit(exit =>
							Exit.isSuccess(exit) ? Effect.void : release,
						),
					)

					// A repeat of a call this run already paid for is a no-op in the
					// record, so give the reserved money back rather than counting the
					// same charge twice — and tell the caller, so it does not buy the
					// same answer from the vendor a second time.
					if (!charged) yield* release
					return charged
				}).pipe(
					Effect.tap(() =>
						Effect.logDebug('budget.chargePaid').pipe(
							Effect.annotateLogs({
								event: 'budget.chargePaid',
								provider,
								tool,
								cents,
							}),
						),
					),
				)

			return Budget.of({
				chargeCheap: (provider: string, cents: number) =>
					// Check and deduct in one indivisible step. Several tool calls run at
					// once, so reading what is left and then subtracting as two steps lets
					// two of them both see enough and both spend it.
					Ref.modify(cheapRef, (s): readonly [CheapCharge, TierState] =>
						s.remaining < cents
							? [{ ok: false as const, remaining: s.remaining }, s]
							: [
									{ ok: true as const, remaining: s.remaining - cents },
									{
										...s,
										spent: s.spent + cents,
										remaining: s.remaining - cents,
									},
								],
					).pipe(
						Effect.flatMap(charge =>
							charge.ok
								? Effect.void
								: new BudgetExceeded({
										tier: 'cheap',
										needed: cents,
										remaining: charge.remaining,
									}),
						),
						Effect.tap(() =>
							Effect.logDebug('budget.chargeCheap').pipe(
								Effect.annotateLogs({
									event: 'budget.chargeCheap',
									provider,
									cents,
								}),
							),
						),
					),

				chargePaid: chargePaidImpl,

				withPaidCharge:
					(
						provider: string,
						cents: number,
						tool: string,
						idempotencyKey: string,
					) =>
					<A, E, R>(vendorCall: () => Effect.Effect<A, E, R>) =>
						Effect.gen(function* () {
							const charged = yield* chargePaidImpl(
								provider,
								cents,
								tool,
								idempotencyKey,
							)
							// Already paid for in this run: the answer is somewhere the
							// caller already has, and calling again would buy it twice.
							if (!charged) return { _tag: 'already_charged' as const }
							const value = yield* Effect.suspend(vendorCall).pipe(
								Effect.onExit(exit =>
									Exit.isSuccess(exit)
										? Effect.void
										: releaseRunAllowance(cents),
								),
							)
							return { _tag: 'bought' as const, value }
						}),

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
