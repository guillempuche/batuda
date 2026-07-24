/**
 * Turns a finished run's shape into a small quality signal, so an automation can
 * tell a well-grounded result from a thin one without inspecting every run by hand.
 *
 * Every run reported `succeeded` before, whether it did six grounded rounds on the
 * company's own site or one search on a nonsense query — nothing to gate on. This
 * derives a compact `quality` block and a `low_confidence` flag from signals the
 * run already produced. The flag is deliberately conservative: it should catch the
 * clearly-thin runs, not second-guess a solid one.
 *
 * The signals differ by run kind, so the check branches:
 *  - enrichment fills a named company's profile, so it keys off the entity match
 *    (already downgraded when a field came from a source that can't speak for the
 *    company) and how much of the profile is grounded;
 *  - a prospect scan reports a list of third parties, so it keys off how many
 *    sources it actually vetted the list against.
 */

export interface RunQualityInput {
	readonly schemaName: string
	/** The run's entity verdict after any per-source downgrade; null for a scan. */
	readonly entityMatch: 'strong' | 'weak' | 'absent' | null
	/** Reflect-loop rounds phase 1 ran (0 on a resume). */
	readonly rounds: number
	/** Distinct sources the run fetched. */
	readonly sourcesTotal: number
	/** Of those, how many are on the company's own domain. */
	readonly sourcesFirstParty: number
	/** Enrichment: profile fields that survived the guards with a value. */
	readonly fieldsGrounded: number
	/** Enrichment: profile fields in scope (0 for a scan). */
	readonly fieldsTotal: number
}

export interface RunQuality {
	readonly rounds: number
	/** Sources on the company's own domain — the ones most trusted to speak for it. */
	readonly sources_matched: number
	readonly fields_grounded: number
	/** Share of the profile that is grounded, 0–1 (0 when nothing was in scope). */
	readonly grounding_ratio: number
	/** True when the result is thin enough that an automation should not act on it unreviewed. */
	readonly low_confidence: boolean
}

export const computeRunQuality = (input: RunQualityInput): RunQuality => {
	const groundingRatio =
		input.fieldsTotal > 0 ? input.fieldsGrounded / input.fieldsTotal : 0
	const isScan = input.schemaName === 'prospect_scan_v1'

	const lowConfidence = isScan
		? // A scan that vetted its list against a single source hasn't done enough to
			// trust unreviewed.
			input.sourcesTotal <= 1
		: // Enrichment: a weak or absent entity match. A run only reaches success with
			// a strong match, so this fires when the per-source gate downgraded it — a
			// field came from a source that can't speak for the company. A strong match
			// stays trusted even on a thin-web company; grounding_ratio is reported in
			// the block for a caller that wants to gate on thinness itself.
			input.entityMatch === 'weak' || input.entityMatch === 'absent'

	return {
		rounds: input.rounds,
		sources_matched: input.sourcesFirstParty,
		fields_grounded: input.fieldsGrounded,
		grounding_ratio: Math.round(groundingRatio * 100) / 100,
		low_confidence: lowConfidence,
	}
}
