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
 * Four signals raise it. Whenever a run was pinned to one company, anything short
 * of clearly reaching that company counts — which covers an enrichment filling
 * that company's profile and equally a scan launched from it, since a scan can be
 * pinned to a subject too and a wrong one there is just as misleading. On top of
 * that, a scan reports a list of third parties, so vetting that list against a
 * single source is thin however well the company itself was found, and coming
 * back with a handful of results where a list was asked for is thin whatever it
 * was vetted against. And a run whose every citation was rejected reached none of
 * the pages it claimed to read, whatever else it did.
 */

import { DISCOVERY_THIN_RESULT_COUNT, isDiscoveryScan } from './discovery-scan'

export interface RunQualityInput {
	readonly schemaName: string
	/**
	 * The run's entity verdict after any per-source downgrade. Null when the run
	 * was pinned to no company at all — an open-ended scan or a freeform brief —
	 * so there was never an entity to match.
	 */
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
	/** Citations the run offered for its findings. */
	readonly citationsSeen: number
	/** Of those, how many resolved to a page the run actually reached. */
	readonly citationsKept: number
	/** Scan: how many results its primary list carries (null for a non-scan). */
	readonly scanResults: number | null
	/** Whether the one refined retry fired after a thin first pass. */
	readonly refined: boolean
}

export interface RunQuality {
	readonly rounds: number
	/** Sources on the company's own domain — the ones most trusted to speak for it. */
	readonly sources_matched: number
	/** Profile fields that survived the guards with a value; absent for a scan. */
	readonly fields_grounded?: number
	/**
	 * Share of the profile that is grounded, 0–1. Absent for a scan, as is
	 * `fields_grounded`: a scan fills no profile, so both would read 0 on every
	 * scan ever run and look like a failing grade rather than "does not apply".
	 */
	readonly grounding_ratio?: number
	/**
	 * Whether the scan's one refined retry fired; absent for a non-scan, which
	 * never has one. Reported so the retry's worth can be read off finished runs
	 * rather than reconstructed from logs — it is the main lever on a thin list.
	 */
	readonly refined?: boolean
	readonly citations_seen: number
	/** Of those, how many pointed at a page the run actually reached. */
	readonly citations_kept: number
	/** True when the result is thin enough that an automation should not act on it unreviewed. */
	readonly low_confidence: boolean
}

export const computeRunQuality = (input: RunQualityInput): RunQuality => {
	const groundingRatio =
		input.fieldsTotal > 0 ? input.fieldsGrounded / input.fieldsTotal : 0
	const isScan = isDiscoveryScan(input.schemaName)

	// Anything short of clearly reaching the company the run was pinned to. Asked
	// of every run kind on purpose: a scan launched from one company is pinned to
	// it just as an enrichment is, and a scan built from the wrong company is no
	// safer to act on unread. A run pinned to nobody has no verdict and so raises
	// nothing here. A strong match stays trusted even on a thin-web company;
	// grounding_ratio is reported for a caller that wants to gate on thinness.
	const unsureOfTheCompany =
		input.entityMatch !== null && input.entityMatch !== 'strong'
	// And a scan that vetted its list of other firms against a single source
	// hasn't done enough to act on unread, however well it found the company.
	const thinlyVetted = isScan && input.sourcesTotal <= 1
	// A scan asked for a list that came back a handful long has searched too
	// narrowly far more often than it has found a small market, so one result
	// must not finish as green as forty.
	const thinResultList =
		input.scanResults !== null &&
		input.scanResults < DISCOVERY_THIN_RESULT_COUNT
	// The findings may well be right, but every page the run cited is one it never
	// reached, so nothing it did backs them. Citing nothing at all is a different
	// shortfall, left to the signals above.
	const nothingStandsBehindIt =
		input.citationsSeen > 0 && input.citationsKept === 0
	const lowConfidence =
		unsureOfTheCompany ||
		thinlyVetted ||
		thinResultList ||
		nothingStandsBehindIt

	return {
		rounds: input.rounds,
		sources_matched: input.sourcesFirstParty,
		...(isScan
			? { refined: input.refined }
			: {
					fields_grounded: input.fieldsGrounded,
					grounding_ratio: Math.round(groundingRatio * 100) / 100,
				}),
		citations_seen: input.citationsSeen,
		citations_kept: input.citationsKept,
		low_confidence: lowConfidence,
	}
}
