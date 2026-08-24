/**
 * Turns a finished run's shape into a small quality signal, so an automation can
 * tell a well-grounded result from a thin one without inspecting every run by hand.
 *
 * Without it a run that did six grounded rounds on the company's own site and one
 * that ran a single search on a nonsense query both report `succeeded`, and there
 * is nothing to gate on. This derives a compact `quality` block and a
 * `low_confidence` flag from signals the run already produced. The flag is deliberately conservative: it should catch the
 * clearly-thin runs, not second-guess a solid one.
 *
 * Six signals raise it. Whenever a run was pinned to one company, anything short
 * of clearly reaching that company counts — which covers an enrichment filling
 * that company's profile and equally a scan launched from it, since a scan can be
 * pinned to a subject too and a wrong one there is just as misleading. On top of
 * that, a scan reports a list of third parties, so vetting that list against a
 * single source is thin however well the company itself was found, and coming
 * back with a handful of results where a list was asked for is thin whatever it
 * was vetted against. And a run whose every citation was rejected reached none of
 * the pages it claimed to read, whatever else it did.
 *
 * The fifth is about what was asked rather than how much came back. A request
 * naming five trades that comes back with sixty companies for one of them passes
 * every count above — sixty is not thin — while answering a fifth of the question,
 * so a part of the request nothing came back for raises the flag on its own.
 *
 * The sixth is about the checks themselves rather than about the result. A run
 * pinned to a company whose name nothing here could read had none of the checks
 * that ask whether its pages are that company's — not weaker checks, no checks —
 * and every one of them was skipped in silence. That is exactly what this flag
 * is for, so it says so and the run is read before it is acted on.
 */

import { DISCOVERY_THIN_RESULT_COUNT, isDiscoveryScan } from './discovery-scan'
import {
	type CoveragePassVerdict,
	partsThoughtAnswered,
	type RequestCoverage,
} from './request-parts'

export interface RunQualityInput {
	readonly schemaName: string
	/**
	 * The run's entity verdict after any per-source downgrade. Null when the run
	 * was pinned to no company at all — an open-ended scan or a freeform brief —
	 * so there was never an entity to match.
	 */
	readonly entityMatch: 'strong' | 'weak' | 'absent' | null
	/**
	 * Whether the run is about one company whose name yielded no match key at all,
	 * so every check that asks whether a page is that company's had nothing to ask
	 * with. Told apart from `entityMatch: null`, which is a run about no one
	 * company: there the checks have nothing to check, which costs nothing.
	 */
	readonly subjectUnreadable: boolean
	/** Reflect-loop rounds phase 1 ran (0 on a resume). */
	readonly rounds: number
	/** Gap-closing rounds phase 2 ran after the first extraction (0 on a resume). */
	readonly gapRounds: number
	/** Distinct sources the run fetched. */
	readonly sourcesTotal: number
	/** Of those, how many are on the company's own domain. */
	readonly sourcesFirstParty: number
	/**
	 * Whether the run had a company website to hold those sources against. An
	 * open-ended search is about no one company, and a company with no website on
	 * record has no site anyone could have read, so neither can count above zero.
	 */
	readonly ownDomainKnown: boolean
	/** Enrichment: profile fields that survived the guards with a value. */
	readonly fieldsGrounded: number
	/** Profile fields in scope — 0 for any run that fills no company profile. */
	readonly fieldsTotal: number
	/** Citations the run offered for its findings. */
	readonly citationsSeen: number
	/** Of those, how many resolved to a page the run actually reached. */
	readonly citationsKept: number
	/** Scan: how many results its primary list carries (null for a non-scan). */
	readonly scanResults: number | null
	/** Whether the one refined retry fired after a thin first pass. */
	readonly refined: boolean
	/**
	 * Which of the parts the request named came back with companies. Null when the
	 * question does not arise — every run that is not a scan, and a request naming
	 * one kind of company, which is answered by companies of that kind.
	 */
	readonly coverage: RequestCoverage | null
	/**
	 * Why the search stopped going back out for the parts nothing answered. Told
	 * apart from the shortfall itself because the two have different causes: a
	 * search that stopped with nothing left to look for lost its rows between two
	 * readings, while one that stopped on the clock or the money simply ran out of
	 * room. Null on every run that never asked the question.
	 */
	readonly coverageStopped: CoveragePassVerdict | null
	/**
	 * What the search still saw as missing when it stopped going back out. Held
	 * against the shortfall the run finally reports to say which parts were lost
	 * after that last look, rather than declined for want of room.
	 */
	readonly coverageLastMissing: ReadonlyArray<string>
	/**
	 * How the list split between companies two independent websites establish and
	 * ones the run could not confirm. Null for a run with no list to split.
	 */
	readonly existence: {
		readonly confirmed: number
		readonly candidates: number
	} | null
}

/**
 * The coverage reading a finished run stores, with the reason the looking stopped
 * beside it. Two parts can read as never looked for with quite different causes,
 * and only the reason tells them apart.
 */
export interface ReportedCoverage extends RequestCoverage {
	/**
	 * Of the parts nothing looked for, those the search finished believing it had
	 * already found. Empty is the healthy reading; anything here is a part lost
	 * between the list the search decided on and the list it reports.
	 */
	readonly thought_answered: ReadonlyArray<string>
	/**
	 * Why the search stopped going back out. Describes the run, not any one part —
	 * a run can stop for want of clock while a part beside it was lost after the
	 * last look, so this never says why a particular part went unlooked-for.
	 * `thought_answered` is what says that.
	 */
	readonly stopped_because: CoveragePassVerdict | null
}

export interface RunQuality {
	readonly rounds: number
	/**
	 * Rounds spent closing the gaps the first extraction left, counted apart from
	 * `rounds`, which covers the gathering loop alone. Two numbers because they
	 * are two pieces of work, and either one on its own makes the run look like
	 * it did less than it did.
	 */
	readonly gap_rounds: number
	/**
	 * Sources on the company's own domain — the ones most trusted to speak for
	 * it. Absent when there was no such domain to hold them against — an
	 * open-ended search, or a company with no website on record — since then it
	 * can only read 0 however well the run went, which looks like a failing grade
	 * rather than "does not apply".
	 */
	readonly sources_matched?: number
	/**
	 * Profile fields that survived the guards with a value. Reported on the same
	 * runs as `grounding_ratio`.
	 */
	readonly fields_grounded?: number
	/**
	 * Share of the profile that is grounded, 0–1. This and `fields_grounded` are
	 * reported only when the run had profile fields to fill: a scan, a brief and
	 * a hunt for contacts have none, so both would read 0 on every one of those
	 * runs and look like a failing grade rather than "does not apply".
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
	/**
	 * Which parts of the request came back with companies, which did not, which of
	 * the missing ones nothing ever went looking for, and why the looking stopped —
	 * so the shortfall can be read off the finished run instead of by searching
	 * again. Absent where the question does not arise — see the input field of the
	 * same name — rather than reported as nothing covered.
	 */
	readonly coverage?: ReportedCoverage
	/**
	 * How many of the companies the run stands behind, and how many it could not
	 * confirm. Absent where the question does not arise — a run with no list.
	 *
	 * Reported, not gated on. What a reader does about a list that came back
	 * mostly candidates is a decision about that list, and turning it into the
	 * run-level flag would put every honest scan behind a review step before
	 * there is any measurement of how often that happens.
	 */
	readonly existence?: {
		readonly confirmed: number
		readonly candidates: number
	}
	/**
	 * Present, and only ever true, when the run's own subject could not be read,
	 * so the checks that hold its pages against it never ran. Written down as the
	 * run's own stated reason rather than left in the logs, because a reader
	 * otherwise sees a result that looks exactly like a checked one.
	 *
	 * Left out entirely where the question does not arise — a run whose subject
	 * was read, and a run that has no subject — so its presence is the whole
	 * signal, and how often it happens can be counted off finished runs.
	 */
	readonly subject_unreadable?: true
	/** True when the result is thin enough that an automation should not act on it unreviewed. */
	readonly low_confidence: boolean
}

export const computeRunQuality = (input: RunQualityInput): RunQuality => {
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
	// And a run that found companies for some of the trades it was asked about
	// answered only some of the request, however long that list is. Whether the
	// market has such companies at all is exactly what a reader has to decide, so
	// it goes to them rather than passing as a full answer.
	const partsWentUnanswered =
		input.coverage !== null && input.coverage.uncovered.length > 0
	// And a run whose subject's name yielded no key was never held against that
	// company at all. `unsureOfTheCompany` cannot see this one: with no keys there
	// is no verdict to be unsure of, so the run arrives here carrying the same
	// empty verdict as a scan that was about nobody in particular.
	const subjectWentUnchecked = input.subjectUnreadable
	const lowConfidence =
		unsureOfTheCompany ||
		thinlyVetted ||
		thinResultList ||
		nothingStandsBehindIt ||
		partsWentUnanswered ||
		subjectWentUnchecked

	return {
		rounds: input.rounds,
		gap_rounds: input.gapRounds,
		...(input.ownDomainKnown
			? { sources_matched: input.sourcesFirstParty }
			: {}),
		...(input.fieldsTotal > 0
			? {
					fields_grounded: input.fieldsGrounded,
					grounding_ratio:
						Math.round((input.fieldsGrounded / input.fieldsTotal) * 100) / 100,
				}
			: {}),
		...(isScan ? { refined: input.refined } : {}),
		citations_seen: input.citationsSeen,
		citations_kept: input.citationsKept,
		...(input.coverage !== null
			? {
					coverage: {
						...input.coverage,
						thought_answered: partsThoughtAnswered(
							input.coverage.unsearched,
							input.coverageLastMissing,
						),
						stopped_because: input.coverageStopped,
					},
				}
			: {}),
		...(input.existence !== null ? { existence: input.existence } : {}),
		...(subjectWentUnchecked ? { subject_unreadable: true as const } : {}),
		low_confidence: lowConfidence,
	}
}
