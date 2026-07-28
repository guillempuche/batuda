/**
 * Holds the fit judgment's evidence to the run's evidence corpus.
 *
 * `disqualifiers` and `fit_checks` each carry an `evidence_quote` + `source_id`,
 * but no other guard reads them — so a confident model could disqualify a company
 * or mark a fit criterion failed on a quote that appears in no fetched page,
 * shipping a fabricated "auditable" trail to the salesperson. This checks each
 * quote against the evidence (the same fuzzy salient-token match the scalar guard
 * uses, so a lightly-reworded real quote still passes) and:
 *  - drops a disqualifier whose quote is fabricated — an unsupported negative
 *    claim about the company must not stand;
 *  - downgrades a fit check with a fabricated quote to `unknown` and clears the
 *    quote — keep the criterion visible, but never assert pass/fail on invented
 *    grounds.
 *
 * A quote-less entry cannot be refuted, so it is left untouched; the whole guard
 * is skipped when there is no corpus (a resume), so nothing is dropped for want
 * of evidence. The verdict prose is the run's own wording rather than a quote, so
 * it is left to the prompt's grounding rules.
 */

import { isPlainObject } from './guard-shapes'
import { isInCorpus } from './scalar-field-guard'

export interface FitEvidenceResult {
	readonly findings: unknown
	/** Disqualifiers dropped because their quote appears in no fetched page. */
	readonly droppedDisqualifiers: number
	/** Fit checks downgraded to `unknown` because their quote was fabricated. */
	readonly unverifiedChecks: number
}

export const guardFitEvidence = (
	findings: unknown,
	corpus: string,
): FitEvidenceResult => {
	if (!isPlainObject(findings))
		return { findings, droppedDisqualifiers: 0, unverifiedChecks: 0 }
	const lowerCorpus = corpus.toLowerCase()
	if (lowerCorpus.trim().length === 0)
		return { findings, droppedDisqualifiers: 0, unverifiedChecks: 0 }

	// A quote is fabricated when it is present but most of its salient tokens are
	// not in the evidence. An absent/blank quote can't be refuted, so it passes.
	const quoteFabricated = (quote: unknown): boolean =>
		typeof quote === 'string' &&
		quote.trim() !== '' &&
		!isInCorpus(quote, lowerCorpus)

	let droppedDisqualifiers = 0
	let unverifiedChecks = 0
	const out: Record<string, unknown> = { ...findings }

	const disqualifiers = out['disqualifiers']
	if (Array.isArray(disqualifiers)) {
		out['disqualifiers'] = disqualifiers.filter(entry => {
			if (isPlainObject(entry) && quoteFabricated(entry['evidence_quote'])) {
				droppedDisqualifiers++
				return false
			}
			return true
		})
	}

	const fitChecks = out['fit_checks']
	if (Array.isArray(fitChecks)) {
		out['fit_checks'] = fitChecks.map(entry => {
			if (isPlainObject(entry) && quoteFabricated(entry['evidence_quote'])) {
				unverifiedChecks++
				const cleaned: Record<string, unknown> = {
					...entry,
					result: 'unknown',
				}
				delete cleaned['evidence_quote']
				return cleaned
			}
			return entry
		})
	}

	return { findings: out, droppedDisqualifiers, unverifiedChecks }
}
