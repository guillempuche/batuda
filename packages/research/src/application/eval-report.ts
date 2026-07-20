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
 * The scores for one run: the three yes/no checks as 0/1, plus precision and recall
 * only where there was something to judge (a run that filled nothing has no
 * precision, a company with no known fields has no recall).
 */
export const scorePayloadsForRun = (score: RunScore): ScorePayload[] => {
	const payloads: ScorePayload[] = [
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
		boolPayload(
			'not_empty',
			!score.empty,
			'returned usable data',
			'returned no usable data',
		),
	]
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
	return payloads
}

/** The offline baseline report: the aggregate rates plus every run's raw score,
 * and the same rates broken out by size/reach bucket and by country so a
 * regression confined to one segment is visible rather than averaged away. */
export interface EvalReport {
	readonly summary: EvalSummary
	readonly runs: ReadonlyArray<RunScore>
	readonly byBucket: Record<string, EvalSummary>
	readonly byCountry: Record<string, EvalSummary>
}

export const buildEvalReport = (
	scores: ReadonlyArray<RunScore>,
): EvalReport => ({
	summary: summarizeScores(scores),
	runs: scores,
	byBucket: groupSummaries(scores, score => score.bucket ?? 'untagged'),
	byCountry: groupSummaries(scores, score => score.country ?? 'unknown'),
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
		'eval.grounded': score.grounded,
		'eval.wrong_company': score.wrongCompany,
		'eval.empty': score.empty,
		'eval.fields_expected': score.fieldsExpected,
		'eval.fields_scored': score.fieldsScored,
		'eval.fields_correct': score.fieldsCorrect,
		'eval.contacts_expected': score.contactsExpected,
		'eval.contacts_found': score.contactsFound,
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
		'eval.grounding_accuracy': summary.groundingAccuracy,
		'eval.wrong_company_rate': summary.wrongCompanyRate,
		'eval.empty_rate': summary.emptyRate,
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
	return attributes
}
