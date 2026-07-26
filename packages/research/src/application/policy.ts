import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import { ResolvedPolicy } from '../domain/types'

// ── Policy resolution ──
// system env defaults → user policy → per-run override (clamped to user policy)
//
// These are a single run's limits. What the whole company may spend on paid
// calls in a month is not one of them: it is a running total across everyone's
// runs, so it is read at the moment of a charge rather than frozen here.

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
				   auto_apply_min_confidence
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
					autoApplyMinConfidence: number | null
			  }
			| undefined

		const base = {
			budgetCents: userPolicy?.budgetCents ?? systemDefaults.budgetCents,
			paidBudgetCents:
				userPolicy?.paidBudgetCents ?? systemDefaults.paidBudgetCents,
			autoApprovePaidCents:
				userPolicy?.autoApprovePaidCents ?? systemDefaults.autoApprovePaidCents,
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
			// A data-trust threshold, not a spending limit, so it isn't clamped;
			// null (the default) means findings never auto-apply.
			autoApplyMinConfidence: userPolicy?.autoApplyMinConfidence ?? null,
		})

		return resolved
	})

/** Clamp a per-run override to the user's ceiling. */
function clamp(override: number | undefined, ceiling: number): number {
	if (override === undefined) return ceiling
	return Math.min(override, ceiling)
}
