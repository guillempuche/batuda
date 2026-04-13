import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import { ResolvedPolicy } from '../domain/types'

// ── Policy resolution ──
// system env defaults → user policy → per-run override (clamped to user policy)

export interface SystemDefaults {
	readonly budgetCents: number
	readonly paidBudgetCents: number
	readonly autoApprovePaidCents: number
	readonly paidMonthlyCapCents: number
	readonly hardCeiling: number
}

export interface PerRunOverrides {
	readonly budgetCents?: number | undefined
	readonly paidBudgetCents?: number | undefined
	readonly autoApprovePaidCents?: number | undefined
	readonly paidMonthlyCapCents?: number | undefined
}

/** Resolve the effective policy for a research run. */
export const resolvePolicy = (input: {
	sql: SqlClient.SqlClient
	userId: string
	systemDefaults: SystemDefaults
	perRunOverrides?: PerRunOverrides | undefined
}) =>
	Effect.gen(function* () {
		const { sql, userId, systemDefaults, perRunOverrides } = input

		// Load user policy (or use system defaults if no row exists)
		const rows = yield* sql`
			SELECT budget_cents, paid_budget_cents, auto_approve_paid_cents,
				   paid_monthly_cap_cents
			FROM user_research_policy
			WHERE user_id = ${userId}
			LIMIT 1
		`

		// Effect SQL auto-transforms snake_case columns → camelCase
		const userPolicy = rows[0] as
			| {
					budgetCents: number
					paidBudgetCents: number
					autoApprovePaidCents: number
					paidMonthlyCapCents: number
			  }
			| undefined

		const base = {
			budgetCents: userPolicy?.budgetCents ?? systemDefaults.budgetCents,
			paidBudgetCents:
				userPolicy?.paidBudgetCents ?? systemDefaults.paidBudgetCents,
			autoApprovePaidCents:
				userPolicy?.autoApprovePaidCents ?? systemDefaults.autoApprovePaidCents,
			paidMonthlyCapCents: Math.min(
				userPolicy?.paidMonthlyCapCents ?? systemDefaults.paidMonthlyCapCents,
				systemDefaults.hardCeiling,
			),
		}

		// Per-run overrides are clamped to user policy, not system ceiling.
		// A buggy frontend can't bypass the user's own spending limits.
		const resolved = new ResolvedPolicy({
			budgetCents: clamp(perRunOverrides?.budgetCents, base.budgetCents),
			paidBudgetCents: clamp(
				perRunOverrides?.paidBudgetCents,
				base.paidBudgetCents,
			),
			autoApprovePaidCents: clamp(
				perRunOverrides?.autoApprovePaidCents,
				base.autoApprovePaidCents,
			),
			paidMonthlyCapCents: base.paidMonthlyCapCents,
		})

		return resolved
	})

/** Clamp a per-run override to the user's ceiling. */
function clamp(override: number | undefined, ceiling: number): number {
	if (override === undefined) return ceiling
	return Math.min(override, ceiling)
}
