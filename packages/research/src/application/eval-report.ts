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
	return payloads
}

/** The offline baseline report: the aggregate rates plus every run's raw score. */
export interface EvalReport {
	readonly summary: EvalSummary
	readonly runs: ReadonlyArray<RunScore>
}

export const buildEvalReport = (
	scores: ReadonlyArray<RunScore>,
): EvalReport => ({
	summary: summarizeScores(scores),
	runs: scores,
})
