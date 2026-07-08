/**
 * Shape + boundary narrowing for a person's research policy (their spend
 * ceilings and the auto-apply trust threshold). The `getPolicy` endpoint is
 * untyped, so the settings screen narrows it here; kept macro-free so the
 * money conversions can be unit-tested in a plain Node environment.
 */

export type ResearchPolicy = {
	readonly budgetCents: number
	readonly paidBudgetCents: number
	readonly autoApprovePaidCents: number
	readonly paidMonthlyCapCents: number
	/** 0–100 threshold to auto-apply verified findings, or null when off. */
	readonly autoApplyMinConfidence: number | null
}

export const EMPTY_POLICY: ResearchPolicy = {
	budgetCents: 0,
	paidBudgetCents: 0,
	autoApprovePaidCents: 0,
	paidMonthlyCapCents: 0,
	autoApplyMinConfidence: null,
}

export function narrowPolicy(raw: unknown): ResearchPolicy {
	if (!raw || typeof raw !== 'object') return EMPTY_POLICY
	const r = raw as Record<string, unknown>
	const cents = (key: string): number =>
		typeof r[key] === 'number' ? r[key] : 0
	return {
		budgetCents: cents('budgetCents'),
		paidBudgetCents: cents('paidBudgetCents'),
		autoApprovePaidCents: cents('autoApprovePaidCents'),
		paidMonthlyCapCents: cents('paidMonthlyCapCents'),
		autoApplyMinConfidence:
			typeof r['autoApplyMinConfidence'] === 'number'
				? r['autoApplyMinConfidence']
				: null,
	}
}

/** Cents → a plain euro string for a form input (e.g. 500 → "5.00"). */
export function centsToEuros(cents: number): string {
	return (cents / 100).toFixed(2)
}

/**
 * A euro string from a form input → whole cents, or null when it isn't a
 * valid non-negative amount (so the caller can reject the submission).
 */
export function eurosToCents(euros: string): number | null {
	const value = Number.parseFloat(euros.trim())
	if (!Number.isFinite(value) || value < 0) return null
	return Math.round(value * 100)
}
