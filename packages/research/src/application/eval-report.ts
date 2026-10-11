/**
 * Turns per-run scores into what the eval runner emits: a plain report object
 * (written to disk for a local, no-secrets baseline) and the attributes a span
 * carries so a pass can be read on the monitoring board.
 */

import {
	type EvalSummary,
	groupSummaries,
	type RunScore,
	summarizeScores,
} from './eval-scoring'

/** The offline baseline report: the aggregate rates plus every run's raw score,
 * and the same rates broken out by size/reach bucket, by country and by market so a
 * regression confined to one segment is visible rather than averaged away. */
export interface EvalReport {
	readonly summary: EvalSummary
	readonly runs: ReadonlyArray<RunScore>
	readonly byBucket: Record<string, EvalSummary>
	readonly byCountry: Record<string, EvalSummary>
	/**
	 * The market figures per market, which is the breakdown they exist for: the
	 * organisation-kind guard reads Spanish, Catalan and English, so a market
	 * answering in one of those scores near 100% while one answering in French or
	 * German scores far lower. Averaged across markets that difference disappears,
	 * which is exactly the fact worth watching. Empty for a pass that held no market
	 * request.
	 */
	readonly byMarket: Record<string, EvalSummary>
}

export const buildEvalReport = (
	scores: ReadonlyArray<RunScore>,
): EvalReport => ({
	summary: summarizeScores(scores),
	runs: scores,
	byBucket: groupSummaries(scores, score => score.bucket ?? 'untagged'),
	byCountry: groupSummaries(scores, score => score.country ?? 'unknown'),
	byMarket: groupSummaries(
		scores.filter(score => score.market !== undefined),
		score => score.market?.name ?? 'unknown',
	),
})

/**
 * Flatten one run's score into span attributes for the monitoring board, so a
 * chart can group runs by company and average the rates over time. Precision and
 * recall ride along only where there was something to judge — the same rule the
 * summary uses, so a run that filled nothing charts no precision rather than a
 * misleading zero.
 */
export const evalSpanAttributes = (
	score: RunScore,
): Record<string, string | number | boolean> => {
	const attributes: Record<string, string | number | boolean> = {
		'eval.company_id': score.id,
		'eval.empty': score.empty,
		'eval.fields_expected': score.fieldsExpected,
		'eval.fields_scored': score.fieldsScored,
		'eval.fields_correct': score.fieldsCorrect,
		'eval.contacts_expected': score.contactsExpected,
		'eval.contacts_found': score.contactsFound,
	}
	// These two ask about the one company the run was sent after, and a chart
	// averages them. A market request has no such company, so charting it as a false
	// on both drags the board's grounding line down for runs that were never asked
	// the question — the same rule the rates below already follow.
	if (score.groundable) {
		attributes['eval.grounded'] = score.grounded
		attributes['eval.wrong_company'] = score.wrongCompany
	}
	if (score.bucket !== undefined) attributes['eval.bucket'] = score.bucket
	if (score.country !== undefined) attributes['eval.country'] = score.country
	if (score.fieldsScored > 0) {
		attributes['eval.field_precision'] =
			score.fieldsCorrect / score.fieldsScored
	}
	if (score.fieldsExpected > 0) {
		attributes['eval.field_recall'] = score.fieldsCorrect / score.fieldsExpected
	}
	if (score.contactsExpected > 0) {
		attributes['eval.contact_recall'] =
			score.contactsFound / score.contactsExpected
	}
	// A market request's own counts, so a chart can group by market and watch the
	// figure that says whether a change reached a language the checks cannot read.
	// The rates ride only where there was something to divide by, the same rule as
	// above, so a market that came back with nothing charts no precision rather than
	// a zero that reads as a quality collapse.
	const market = score.market
	if (market !== undefined) {
		attributes['eval.market'] = market.name
		attributes['eval.rows_returned'] = market.rowsReturned
		attributes['eval.rows_right_kind'] = market.rowsRightKind
		attributes['eval.rows_removed'] = market.rowsRemoved
		attributes['eval.rows_removed_ruled'] = market.rowsRemovedRuled
		attributes['eval.rows_wrongly_removed'] = market.rowsWronglyRemoved
		attributes['eval.rows_located'] = market.rowsLocated
		attributes['eval.rows_duplicated'] = market.rowsDuplicated
		attributes['eval.rows_possibly_duplicated'] = market.rowsPossiblyDuplicated
		attributes['eval.parts_expected'] = market.partsExpected
		attributes['eval.parts_answered'] = market.partsAnswered
		// The run's own reckoning, charted per run so a rate that moves across a
		// pass can be traced to the run that moved it. Absent where the run stored
		// none — reporting nought there would chart a clean run.
		const reckoning = market.reportedCoverage
		if (reckoning !== null) {
			attributes['eval.reported_missing'] = reckoning.missing
			attributes['eval.reported_never_searched'] = reckoning.neverSearched
			attributes['eval.reported_thought_answered'] = reckoning.thoughtAnswered
		}
		// Absent where the run said nothing, which is not the same as a run that
		// finished looking.
		if (market.searchingStopped !== null) {
			attributes['eval.searching_stopped'] = market.searchingStopped
		}
		if (market.partsExpected > 0) {
			attributes['eval.request_coverage'] =
				market.partsAnswered / market.partsExpected
		}
		if (market.rowsReturned > 0) {
			attributes['eval.organisation_kind_precision'] =
				market.rowsRightKind / market.rowsReturned
			// Which method settled each row, so a chart can tell a pass the model
			// answered for from one where it faltered and the figure fell back.
			attributes['eval.rows_judged'] = market.rowsJudged
			attributes['eval.rows_golden_listed'] = market.rowsGoldenListed
			attributes['eval.rows_unjudged'] = market.rowsUnjudged
			attributes['eval.duplicate_rate'] =
				market.rowsDuplicated / market.rowsReturned
			attributes['eval.possible_duplicate_rate'] =
				market.rowsPossiblyDuplicated / market.rowsReturned
			attributes['eval.location_fill'] =
				market.rowsLocated / market.rowsReturned
		}
	}
	return attributes
}

/**
 * Flatten the whole-batch summary into span attributes for the monitoring board —
 * the top-line rates a drift chart tracks across model and prompt changes. A null
 * precision/recall (nothing filled, or no known fields) is left off rather than
 * charted as a zero.
 */
export const evalSummaryAttributes = (
	summary: EvalSummary,
): Record<string, string | number | boolean> => {
	const attributes: Record<string, string | number | boolean> = {
		'eval.runs': summary.runs,
		'eval.low_confidence_rate': summary.lowConfidenceRate,
		'eval.empty_rate': summary.emptyRate,
	}
	// Grounding and the two look-alike rates are all about the one company a run was
	// sent after, so a pass of market requests has no reading for any of them and
	// charts none rather than a nought that reads as a collapse.
	if (summary.groundingAccuracy !== null) {
		attributes['eval.grounding_accuracy'] = summary.groundingAccuracy
	}
	if (summary.wrongCompanyRate !== null) {
		attributes['eval.wrong_company_rate'] = summary.wrongCompanyRate
	}
	if (summary.wrongCompanyAutoApplicableRate !== null) {
		attributes['eval.wrong_company_auto_applicable_rate'] =
			summary.wrongCompanyAutoApplicableRate
	}
	if (summary.fieldsFilledPerRun !== null) {
		attributes['eval.fields_filled_per_run'] = summary.fieldsFilledPerRun
	}
	if (summary.profileFieldsTotal !== null) {
		attributes['eval.profile_fields_total'] = summary.profileFieldsTotal
	}
	if (summary.contactsNamedPerRun !== null) {
		attributes['eval.contacts_named_per_run'] = summary.contactsNamedPerRun
	}
	if (summary.contactsTitledPerRun !== null) {
		attributes['eval.contacts_titled_per_run'] = summary.contactsTitledPerRun
	}
	if (summary.fieldPrecision !== null) {
		attributes['eval.field_precision'] = summary.fieldPrecision
	}
	if (summary.fieldRecall !== null) {
		attributes['eval.field_recall'] = summary.fieldRecall
	}
	if (summary.contactRecall !== null) {
		attributes['eval.contact_recall'] = summary.contactRecall
	}
	if (summary.organisationKindPrecision !== null) {
		attributes['eval.organisation_kind_precision'] =
			summary.organisationKindPrecision
	}
	if (summary.requestCoverage !== null) {
		attributes['eval.request_coverage'] = summary.requestCoverage
	}
	if (summary.neverSearchedShare !== null) {
		attributes['eval.never_searched_share'] = summary.neverSearchedShare
	}
	if (summary.scansSayingWhyTheyStopped !== null) {
		attributes['eval.scans_saying_why_they_stopped'] =
			summary.scansSayingWhyTheyStopped
	}
	if (summary.scansCutOff !== null) {
		attributes['eval.scans_cut_off'] = summary.scansCutOff
	}
	if (summary.scansThatNeverAnswered !== null) {
		attributes['eval.scans_that_never_answered'] =
			summary.scansThatNeverAnswered
	}
	// Reported whenever any scan ran, including nought — that is the reading that
	// says the never-searched share above is blind rather than clean.
	if (summary.scansReportingCoverage !== null) {
		attributes['eval.scans_reporting_coverage'] = summary.scansReportingCoverage
	}
	// Charted because nought is the reading that matters: any run above it had its
	// two readings of what it gathered disagree.
	if (summary.partsThoughtAnswered !== null) {
		attributes['eval.parts_thought_answered'] = summary.partsThoughtAnswered
	}
	if (summary.duplicateRate !== null) {
		attributes['eval.duplicate_rate'] = summary.duplicateRate
	}
	if (summary.possibleDuplicateRate !== null) {
		attributes['eval.possible_duplicate_rate'] = summary.possibleDuplicateRate
	}
	if (summary.locationFill !== null) {
		attributes['eval.location_fill'] = summary.locationFill
	}
	if (summary.confirmationRate !== null) {
		attributes['eval.confirmation_rate'] = summary.confirmationRate
	}
	// What the lists are worth to somebody working through them. Counts and
	// shares only: which known firms a pass missed is in the report, never here.
	if (summary.websiteRate !== null) {
		attributes['eval.website_rate'] = summary.websiteRate
	}
	if (summary.headcountFill !== null) {
		attributes['eval.headcount_fill'] = summary.headcountFill
	}
	if (summary.narrowerPlaceRate !== null) {
		attributes['eval.narrower_place_rate'] = summary.narrowerPlaceRate
	}
	if (summary.knownCompanies !== null) {
		attributes['eval.known_companies_listed'] =
			summary.knownCompanies.found.length
		attributes['eval.known_companies_missed'] =
			summary.knownCompanies.missed.length
	}
	if (summary.roundsPerScan !== null) {
		attributes['eval.rounds_per_scan'] = summary.roundsPerScan
	}
	if (summary.gapRoundsPerScan !== null) {
		attributes['eval.gap_rounds_per_scan'] = summary.gapRoundsPerScan
	}
	if (summary.repeatedSearchShare !== null) {
		attributes['eval.repeated_search_share'] = summary.repeatedSearchShare
	}
	if (summary.scansLostToExtraction !== null) {
		attributes['eval.scans_lost_to_extraction'] = summary.scansLostToExtraction
	}
	if (summary.rowsPerScan !== null) {
		attributes['eval.rows_per_scan'] = summary.rowsPerScan
	}
	if (summary.costPerRun !== null) {
		attributes['eval.cost_cents_per_run'] = summary.costPerRun
	}
	if (summary.costPerGroundedRun !== null) {
		attributes['eval.cost_cents_per_grounded_run'] = summary.costPerGroundedRun
	}
	if (summary.paidCostPerRun !== null) {
		attributes['eval.paid_cost_cents_per_run'] = summary.paidCostPerRun
	}
	if (summary.tokensPerRun !== null) {
		attributes['eval.tokens_per_run'] = summary.tokensPerRun
	}
	if (summary.creditsPerRun !== null) {
		attributes['eval.credits_per_run'] = summary.creditsPerRun
	}
	// Which models answered, so a chart of quality over time can tell a real
	// change from a pass that was carried out by a different model than the one
	// it was set up to measure.
	const answered = Object.keys(summary.callsByModel)
	if (answered.length > 0) {
		attributes['eval.answered_by'] = answered.sort().join(',')
	}
	if (summary.cascadedRunRate !== null) {
		attributes['eval.cascaded_run_rate'] = summary.cascadedRunRate
	}
	return attributes
}
