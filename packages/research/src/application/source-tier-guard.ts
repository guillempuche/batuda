/**
 * Caps the confidence of a per-field value whose only source is a third party,
 * not the company itself.
 *
 * The rest of the guard chain trusts any value that appears in a page the run
 * fetched. That was safe when the run only read the company's own site, but the
 * richer search vendors pull in company-profile aggregators (Datanyze, ZoomInfo
 * and the like) whose headcounts, revenues, and phone numbers are often estimated
 * or stale. Left alone, an aggregator's guess grounds and ships at the same high
 * confidence as a fact stated on the company's own page — "grounding-laundering".
 *
 * This guard draws one line: a value cited to the target's **own domain** (or the
 * official registry) is first-party and keeps its confidence; a value cited to any
 * other host is third-party and has its confidence capped to no better than medium.
 * It never drops a value — third-party data is still useful — it just stops the
 * caller from trusting an outside estimate like the company's own word.
 *
 * A citation that is not a web address at all sits on neither side of that line and
 * is left alone: an internal id for a page the run already holds is not somebody
 * else's site, and a value read off such a page keeps the confidence it came with.
 *
 * The change a person is offered to accept — a proposed update — is graded like
 * everything else. Its confidence is the one written to the record on approval, so
 * it is held to the same line as the copy in the company profile; one set of
 * findings never states two different confidences for a single fact.
 *
 * It applies only when the run has a known target (an entity-grounded run with
 * target domains); a discovery scan with no single subject is left untouched.
 */

import { isSourcedField } from './guard-shapes'
import { hostOf, isWebAddress } from './source-key'

// Confidence a third-party-sourced value is held to: kept and usable, but marked
// no better than medium so it reads as "reported elsewhere", not "the company says
// so". Below the 0.7 the UI treats as trustworthy.
export const THIRD_PARTY_CONFIDENCE_CAP = 0.6

/**
 * The lowest auto-apply threshold an org can effectively set. Kept above the
 * third-party cap so a value whose confidence was capped (an outside estimate,
 * not the company's own word) can never clear an auto-apply bar — it always
 * waits for a person.
 */
export const AUTO_APPLY_CONFIDENCE_FLOOR = THIRD_PARTY_CONFIDENCE_CAP + 0.05

// A block-level citation array is not a per-field value: an entry there records
// where a claim came from, not a claim to grade.
const SKIP_KEYS = new Set(['citations'])

// The value came from one of the target's own hosts — the company's own domain or
// a subdomain of it. A look-alike or aggregator host never ends with ".<target>".
// Exported so page ranking can float the company's own pages ahead of aggregators.
export const isFirstPartyHost = (
	host: string,
	targetHosts: ReadonlyArray<string>,
): boolean =>
	targetHosts.some(target => host === target || host.endsWith(`.${target}`))

export interface SourceTierResult {
	readonly findings: unknown
	/** Fields whose confidence was lowered because their source was third-party. */
	readonly capped: number
}

/**
 * Cap the confidence of every per-field value whose cited source is not one of the
 * target's own hosts. `targetHosts` are the run's target domains (registrable, no
 * scheme/`www.`); an empty list means the run has no single subject, so the guard
 * is a no-op.
 */
export const enforceSourceTier = (
	findings: unknown,
	targetHosts: ReadonlyArray<string>,
): SourceTierResult => {
	if (targetHosts.length === 0) return { findings, capped: 0 }
	let capped = 0

	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk)
		if (value === null || typeof value !== 'object') return value

		if (isSourcedField(value)) {
			const wrapper = value as {
				source_id?: unknown
				confidence?: unknown
			}
			// Only a citation that is a web address has a host to place on one side of
			// the line or the other. An internal id for a page the run already holds —
			// what a mailbox read off the company's own contact page is cited to — is
			// left at the confidence it arrived with.
			if (
				typeof wrapper.source_id === 'string' &&
				isWebAddress(wrapper.source_id)
			) {
				const host = hostOf(wrapper.source_id)
				if (host !== null && !isFirstPartyHost(host, targetHosts)) {
					const current =
						typeof wrapper.confidence === 'number' ? wrapper.confidence : null
					if (current === null || current > THIRD_PARTY_CONFIDENCE_CAP) {
						capped++
						return { ...value, confidence: THIRD_PARTY_CONFIDENCE_CAP }
					}
				}
			}
			return value
		}

		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) =>
				SKIP_KEYS.has(k) ? [k, v] : [k, walk(v)],
			),
		)
	}

	return { findings: walk(findings), capped }
}
