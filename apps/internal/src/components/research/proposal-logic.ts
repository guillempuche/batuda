/**
 * Pure presentation logic for research proposals — kept free of JSX and the
 * Lingui macro so it can be unit-tested in a plain Node environment. The
 * badge components (`trust-badge.tsx`, `proposal-outcome.tsx`) and the inbox
 * import from here; the human-readable labels live in those components.
 */

import type { VerificationVerdict } from '@batuda/domain'

/** Outcome of trying to apply or reject one proposal (single or in a batch). */
export type ProposalOutcome =
	| 'applied'
	| 'created'
	| 'duplicate'
	| 'rejected'
	| 'conflict'
	| 'invalid'
	| 'no_applicable_fields'
	| 'run_not_found'
	| 'proposal_not_found'
	| 'error'

/** How trustworthy a finding is, which drives which inbox tier it lands in. */
export type TrustTier = 'trustworthy' | 'needs_review'

/** Visual tone a badge renders in — maps to a colour in the badge component. */
export type Tone = 'positive' | 'info' | 'caution' | 'negative' | 'neutral'

/** The trust signals a proposal or channel carries. */
export type TrustSignal = {
	readonly verification: string | null
	readonly confidence: number | null
	readonly machineCheckable: boolean
}

/**
 * Confidence (0–100) at or above which a machine-checkable, deliverable
 * finding counts as trustworthy by default. A finding with no confidence
 * score still counts if its verdict is `deliverable` — the verdict is the
 * stronger signal.
 */
export const DEFAULT_TRUST_THRESHOLD = 70

/**
 * Lower is better — used to sort proposals so the most-deliverable surface
 * first. Anything unrecognised sorts last.
 */
const VERDICT_RANK: Record<VerificationVerdict, number> = {
	deliverable: 0,
	risky: 1,
	catch_all: 2,
	unknown: 3,
	undeliverable: 4,
}

export function verdictRank(verification: string | null): number {
	if (verification !== null && verification in VERDICT_RANK) {
		return VERDICT_RANK[verification as VerificationVerdict]
	}
	return Number.POSITIVE_INFINITY
}

/**
 * A finding is "trustworthy" (safe to batch-apply) only when it can be
 * machine-verified, its email verdict is `deliverable`, and — when a
 * confidence score is present — it clears the threshold. Everything else
 * ("risky"/"unknown" verdicts, free-text fields, low confidence, guessed
 * values) needs a human to look at it.
 */
export function trustTier(
	signal: TrustSignal,
	threshold: number = DEFAULT_TRUST_THRESHOLD,
): TrustTier {
	const confidentEnough =
		signal.confidence === null || signal.confidence >= threshold
	if (
		signal.machineCheckable &&
		signal.verification === 'deliverable' &&
		confidentEnough
	) {
		return 'trustworthy'
	}
	return 'needs_review'
}

/**
 * Channel confidence reaches the UI two ways: a 0–1 fraction straight from
 * the model, or a 0–100 score from an enrichment provider. Normalise both to
 * a rounded 0–100 so a badge never shows "1%" for a 0.9 model score.
 */
export function normalizeConfidence(
	confidence: number | null | undefined,
): number | null {
	if (confidence === null || confidence === undefined) return null
	if (!Number.isFinite(confidence)) return null
	const score = confidence <= 1 ? confidence * 100 : confidence
	return Math.round(Math.max(0, Math.min(100, score)))
}

/** Tone for an email verdict badge. */
export function verdictTone(verification: string | null): Tone {
	switch (verification) {
		case 'deliverable':
			return 'positive'
		case 'risky':
		case 'catch_all':
			return 'caution'
		case 'undeliverable':
			return 'negative'
		default:
			return 'neutral'
	}
}

/** Tone for a proposal-apply outcome badge. */
export function outcomeTone(outcome: ProposalOutcome): Tone {
	switch (outcome) {
		case 'applied':
		case 'created':
			return 'positive'
		case 'duplicate':
			return 'info'
		case 'conflict':
			return 'caution'
		case 'rejected':
			return 'neutral'
		default:
			// invalid, no_applicable_fields, run_not_found, proposal_not_found, error
			return 'negative'
	}
}

/**
 * Whether an outcome means the finding is now in the CRM (either applied to
 * an existing record, created as a new one, or merged into a duplicate).
 */
export function isEnteredOutcome(outcome: ProposalOutcome): boolean {
	return (
		outcome === 'applied' || outcome === 'created' || outcome === 'duplicate'
	)
}
