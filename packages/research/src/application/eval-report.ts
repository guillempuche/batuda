/**
 * Turns per-run scores into the two things the eval runner emits: a plain report
 * object (written to disk for a local, no-secrets baseline) and the set of 0–1
 * scores the observability platform expects (one per metric, attached to a run).
 *
 * Every metric is framed so that 1 = good and `passed` = the run met the bar — so a
 * "wrong company" run scores 0 on `not_wrong_company`, not 1. That keeps the
 * dashboard's pass/fail direction consistent across every metric.
 */

import {
	type EvalSummary,
	groupSummaries,
	type RunScore,
	summarizeScores,
} from './eval-scoring'

/** One score submission: a 0–1 value plus a pass/fail verdict and a short reason. */
export interface ScorePayload {
	readonly name: string
	readonly value: number
	readonly passed: boolean
	readonly feedback: string
}

const boolPayload = (
	name: string,
	ok: boolean,
	whenOk: string,
	whenNot: string,
): ScorePayload => ({
	name,
	value: ok ? 1 : 0,
	passed: ok,
	feedback: ok ? whenOk : whenNot,
})

/**
 * The scores for one run: the yes/no checks as 0/1, plus a rate only where there was
 * something to judge (a run that filled nothing has no precision, a company with no
 * known fields has no recall, a market that came back with no rows has nothing to
 * judge row by row).
 */
export const scorePayloadsForRun = (score: RunScore): ScorePayload[] => {
	const payloads: ScorePayload[] = [
		boolPayload(
			'not_empty',
			!score.empty,
			'returned usable data',
			'returned no usable data',
		),
	]
	// Both of these ask about the one company the run was sent after, so a market
	// request has no answer to give. Sending them anyway would file every market run
	// as having failed to reach a company nobody named.
	if (score.groundable) {
		payloads.push(
			boolPayload(
				'grounding',
				score.grounded,
				'reached the target company',
				'did not reach the target company',
			),
			boolPayload(
				'not_wrong_company',
				!score.wrongCompany,
				'data came from the target',
				'returned another company as a success',
			),
		)
	}
	if (score.fieldsScored > 0) {
		payloads.push({
			name: 'field_precision',
			value: score.fieldsCorrect / score.fieldsScored,
			passed: score.fieldsCorrect === score.fieldsScored,
			feedback: `${score.fieldsCorrect}/${score.fieldsScored} filled fields correct`,
		})
	}
	if (score.fieldsExpected > 0) {
		payloads.push({
			name: 'field_recall',
			value: score.fieldsCorrect / score.fieldsExpected,
			passed: score.fieldsCorrect === score.fieldsExpected,
			feedback: `${score.fieldsCorrect}/${score.fieldsExpected} known fields recovered`,
		})
	}
	// Contacts are outside the scorable-field set, so their recall is tracked on its
	// own — a run can fill every field yet return the decision-makers with no title,
	// the exact gap this metric watches.
	if (score.contactsExpected > 0) {
		payloads.push({
			name: 'contact_recall',
			value: score.contactsFound / score.contactsExpected,
			passed: score.contactsFound === score.contactsExpected,
			feedback: `${score.contactsFound}/${score.contactsExpected} known contacts found with a title`,
		})
	}
	// What a market request is graded on. Coverage rides on the parts asked for, so
	// it reports even when the list came back empty — nothing found is the answer
	// there, not the absence of one. The other three divide by the rows, so they only
	// ride when there were rows to judge.
	const market = score.market
	if (market !== undefined) {
		if (market.partsExpected > 0) {
			payloads.push({
				name: 'request_coverage',
				value: market.partsAnswered / market.partsExpected,
				passed: market.partsAnswered === market.partsExpected,
				feedback: `${market.partsAnswered}/${market.partsExpected} requested parts answered`,
			})
		}
		// Reported whenever the run removed anything, which is a different condition
		// from having returned rows: a search can remove companies and come back with
		// none, and that is the case most worth seeing.
		// Only where the judge actually ruled on something. A run that removed rows
		// the judge never answered for has nothing to report here, and publishing a
		// pass for it would score an unasked question as a clean one.
		if (market.rowsRemovedRuled > 0) {
			payloads.push({
				name: 'kept_real_companies',
				value: 1 - market.rowsWronglyRemoved / market.rowsRemovedRuled,
				passed: market.rowsWronglyRemoved === 0,
				feedback: `${market.rowsWronglyRemoved}/${market.rowsRemovedRuled} organisations the run removed were companies after all (${market.rowsRemoved} removed in all)`,
			})
		}
		if (market.rowsReturned > 0) {
			payloads.push(
				{
					name: 'organisation_kind_precision',
					value: market.rowsRightKind / market.rowsReturned,
					passed: market.rowsRightKind === market.rowsReturned,
					feedback: `${market.rowsRightKind}/${market.rowsReturned} rows are the kind of organisation asked for`,
				},
				{
					name: 'not_duplicated',
					value: 1 - market.rowsDuplicated / market.rowsReturned,
					passed: market.rowsDuplicated === 0,
					feedback: `${market.rowsDuplicated}/${market.rowsReturned} rows are another row's company again`,
				},
				{
					// Not marked failed on its own: this one counts pairs no fold may
					// safely join, so a list as good as the rules allow still counts some
					// here. What it is for is the gap to the strict count — rows repeating
					// a company that nothing structural can tell from two companies with
					// near-identical names — which is a reader's cue to look rather than a
					// fault the run could have avoided.
					name: 'not_possibly_duplicated',
					value: 1 - market.rowsPossiblyDuplicated / market.rowsReturned,
					passed: market.rowsPossiblyDuplicated === market.rowsDuplicated,
					feedback: `${market.rowsPossiblyDuplicated}/${market.rowsReturned} rows may be another row's company again, ${market.rowsPossiblyDuplicated - market.rowsDuplicated} of them beyond what the fold can join`,
				},
				{
					name: 'location_fill',
					value: market.rowsLocated / market.rowsReturned,
					passed: market.rowsLocated === market.rowsReturned,
					feedback: `${market.rowsLocated}/${market.rowsReturned} rows say what town or province the company is in`,
				},
				{
					// Not marked failed short of every row: this one is MEANT to sit
					// below the rest. A market where half the companies have one thin
					// website is a market that half-confirms, and grading that red would
					// report the check working as the check failing.
					name: 'confirmation_rate',
					value: market.rowsConfirmed / market.rowsReturned,
					passed: market.rowsConfirmed > 0,
					feedback: `${market.rowsConfirmed}/${market.rowsReturned} rows are established by two independent websites`,
				},
			)
		}
	}
	return payloads
}

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
	// Reported whenever any scan ran, including nought — that is the reading that
	// says the figure above is blind rather than clean.
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
