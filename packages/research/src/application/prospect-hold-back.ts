import { NAME_ONLY_EVIDENCE, NAME_ONLY_EVIDENCE_FIELD } from './name-only-guard'
import { MARKS_FIELD, OUTSIDE_REQUESTED_PLACE } from './row-marks'

/** The parts of a scan's row that say whether the run stands behind it. */
export interface ProspectHoldBackInput {
	readonly unconfirmed_reason?: string | undefined
	readonly [NAME_ONLY_EVIDENCE_FIELD]?: string | undefined
	readonly [MARKS_FIELD]?: ReadonlyArray<string> | undefined
}

/** What a run held back about one company, and which of the two things it held. */
export interface ProspectHoldBack {
	/**
	 * The run tried and could not establish the company is real — either in its
	 * own words, or because every page citing it was a list of many companies and
	 * it carries neither a site nor a place.
	 */
	readonly couldNotConfirm: boolean
	/**
	 * The run established the company is somewhere other than the area asked
	 * about. Kept apart from `couldNotConfirm` because it is a finding rather than
	 * a failure to reach one, and one answer for both tells a reader neither.
	 */
	readonly outsidePlace: boolean
	/** Either of the two, for a caller that only asks whether anything is wrong. */
	readonly holdsBack: boolean
	/** The run's own sentence, absent when it offered none a reader could act on. */
	readonly spokenReason: string | undefined
}

/**
 * Whether a run held something back about this company.
 *
 * The answer gates more than what a reader is shown: it decides whether the
 * company may be recorded as a checked one on this run's word alone.
 */
export const prospectHoldBack = (
	prospect: ProspectHoldBackInput,
): ProspectHoldBack => {
	const trimmed = prospect.unconfirmed_reason?.trim()
	// A reason of only blank space is no reason: it would hold the company back
	// while naming no cause a reader could act on.
	const spokenReason =
		trimmed !== undefined && trimmed !== '' ? trimmed : undefined
	const nameOnly = prospect[NAME_ONLY_EVIDENCE_FIELD] === NAME_ONLY_EVIDENCE
	const couldNotConfirm = spokenReason !== undefined || nameOnly
	const outsidePlace =
		prospect[MARKS_FIELD]?.includes(OUTSIDE_REQUESTED_PLACE) ?? false
	return {
		couldNotConfirm,
		outsidePlace,
		holdsBack: couldNotConfirm || outsidePlace,
		spokenReason,
	}
}
