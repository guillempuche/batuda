/**
 * Drops fabricated citations from a run's findings before they are persisted.
 *
 * The model cites sources by a free-text `source_id`, and left unchecked it will
 * invent them. Only a source the run actually fetched may be cited, so this
 * walks the findings and removes every citation whose `source_id` is not backed
 * by a fetched page. A descriptive finding keeps its remaining citations; a
 * proposed CRM update left with none is dropped whole, because an uncited
 * proposed write is exactly the fabrication we must never let reach the apply
 * path.
 *
 * The walk is structural, not path-based: `citations` sits at a different depth
 * in every findings schema, so it filters wherever it finds a `citations` array.
 */

import { canonicalizeUrl, hostOf } from './source-key'

export interface CitationValidation {
	readonly findings: unknown
	/** How many citations were seen and how many survived, for observability. */
	readonly total: number
	readonly kept: number
}

/**
 * Builds the "is this citation backed by a fetched source" test for a run from its
 * linked sources. A citation is accepted when its URL matches a fetched source
 * exactly (canonical URL or the opaque source id) OR when its site (host) matches
 * one a fetched source belongs to — so a model that tidied the URL (dropped the
 * path, added `www.`, cited the homepage) is still credited to the page it read,
 * while an off-site (aggregator or fabricated) citation is still rejected. Judging
 * grounding by site matches what the eval measures; per-value truth is unaffected,
 * since the value-provenance guard checks each value against the evidence separately.
 */
export const groundedCitationTest = (
	sources: ReadonlyArray<{
		readonly localRef: string
		readonly sourceId: string
	}>,
): ((sourceId: string) => boolean) => {
	const keys = new Set<string>()
	const hosts = new Set<string>()
	for (const source of sources) {
		keys.add(canonicalizeUrl(source.localRef))
		keys.add(source.sourceId)
		const host = hostOf(source.localRef)
		if (host !== null) hosts.add(host)
	}
	return sourceId => {
		if (keys.has(canonicalizeUrl(sourceId)) || keys.has(sourceId)) return true
		const host = hostOf(sourceId)
		return host !== null && hosts.has(host)
	}
}

const hasCitations = (entry: unknown): boolean => {
	const citations = (entry as { citations?: unknown }).citations
	return Array.isArray(citations) && citations.length > 0
}

export const validateFindingCitations = (
	findings: unknown,
	isGrounded: (sourceId: string) => boolean,
): CitationValidation => {
	let total = 0
	let kept = 0

	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === 'citations') {
				return value.filter(entry => {
					const sourceId = (entry as { source_id?: unknown }).source_id
					total++
					const ok = typeof sourceId === 'string' && isGrounded(sourceId)
					if (ok) kept++
					return ok
				})
			}
			const walked = value.map(item => walk(item))
			// A proposed update whose citations were all dropped is itself dropped —
			// an uncited proposed CRM write must never become applyable.
			return key === 'proposed_updates' ? walked.filter(hasCitations) : walked
		}
		if (value !== null && typeof value === 'object') {
			// A per-field Sourced wrapper carries its own `source_id` beside a
			// `value` (a bare citation entry has a source_id but no `value`). Judge it
			// like a citation, but drop the whole field when the source was not
			// fetched: a single scalar with a fabricated source is treated as absent
			// rather than shipped unsourced, so a value that never reached a real page
			// cannot survive. (A descriptive finding's citations array still keeps its
			// value and drops only the bad citation — that rule is for prose, not a
			// scalar fact.)
			const record = value as { source_id?: unknown; value?: unknown }
			if (typeof record.source_id === 'string' && 'value' in record) {
				total++
				if (isGrounded(record.source_id)) {
					kept++
					return value
				}
				return null
			}
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(
					([k, v]) => [k, walk(v, k)] as const,
				),
			)
		}
		return value
	}

	return { findings: walk(findings), total, kept }
}
