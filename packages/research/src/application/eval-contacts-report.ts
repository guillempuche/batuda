/**
 * Turns per-run contact scores into the offline baseline report (written to disk
 * for a no-secrets local comparison) and the eval.* span attributes the
 * monitoring board charts — mirroring eval-report.ts. These are the numbers the
 * FullEnrich spend decision rests on: recall lift read against the cost delta
 * across the enrich configs.
 */

import {
	type ContactEvalSummary,
	type ContactRunScore,
	summarizeContactScores,
} from './eval-contacts-scoring'

/** The offline baseline report: the aggregate rates plus every run's raw score. */
export interface ContactEvalReport {
	readonly summary: ContactEvalSummary
	readonly runs: ReadonlyArray<ContactRunScore>
}

export const buildContactEvalReport = (
	scores: ReadonlyArray<ContactRunScore>,
): ContactEvalReport => ({
	summary: summarizeContactScores(scores),
	runs: scores,
})

// A null rate (nothing to judge) is left off the span rather than charted as a
// misleading zero — the same rule the summary uses.
const withOptionalRate = (
	attributes: Record<string, string | number | boolean>,
	key: string,
	value: number | null,
): Record<string, string | number | boolean> =>
	value === null ? attributes : { ...attributes, [key]: value }

/**
 * Flatten one run's score into span attributes for the monitoring board, so a
 * chart can group runs by company and average the rates over time.
 */
export const contactEvalSpanAttributes = (
	score: ContactRunScore,
): Record<string, string | number | boolean> => ({
	'eval.company_id': score.id,
	'eval.contacts_expected': score.contactsExpected,
	'eval.contacts_matched': score.contactsMatched,
	'eval.decision_makers_expected': score.decisionMakersExpected,
	'eval.decision_makers_matched': score.decisionMakersMatched,
	'eval.deliverable_returned': score.deliverableReturned,
	'eval.spend_cents': score.spendCents,
	'eval.empty': score.empty,
})

/**
 * Flatten the whole-batch summary into span attributes — the top-line recall and
 * cost a drift chart tracks across enrich configs (hunter vs fallback vs union).
 */
export const contactEvalSummaryAttributes = (
	summary: ContactEvalSummary,
): Record<string, string | number | boolean> => {
	let attributes: Record<string, string | number | boolean> = {
		'eval.runs': summary.runs,
		'eval.empty_rate': summary.emptyRate,
	}
	attributes = withOptionalRate(
		attributes,
		'eval.contact_recall',
		summary.contactRecall,
	)
	attributes = withOptionalRate(
		attributes,
		'eval.decision_maker_recall',
		summary.decisionMakerRecall,
	)
	attributes = withOptionalRate(
		attributes,
		'eval.email_precision',
		summary.emailPrecision,
	)
	attributes = withOptionalRate(
		attributes,
		'eval.cost_per_verified_contact',
		summary.costPerVerifiedContact,
	)
	return attributes
}
