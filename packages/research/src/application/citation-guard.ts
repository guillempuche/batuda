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

/**
 * A per-field scalar nulled because its cited source was not among the run's fetched
 * pages — recorded so the grounding trace can tell a citation-guard drop apart from a
 * scalar-guard one when a field comes back empty.
 */
export interface CitationDrop {
	readonly field: string
	readonly value: string
	readonly sourceId: string
}

export interface CitationValidation {
	readonly findings: unknown
	/** How many citations were seen and how many survived, for observability. */
	readonly total: number
	readonly kept: number
	/** Per-field scalars dropped because their cited source was never fetched. */
	readonly drops: ReadonlyArray<CitationDrop>
}

// Bound a dropped value so a long string in the value slot can't bloat a log line.
const boundDropValue = (value: unknown): string => {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/**
 * Builds the "is this citation backed by a source the run actually saw" test, from a
 * run's linked (fetched) sources plus the hosts of the search results it surfaced. A
 * citation is accepted when its URL matches a fetched source exactly (canonical URL or
 * the opaque source id) OR when its site (host) matches one a fetched source belongs to
 * — so a model that tidied the URL (dropped the path, added `www.`, cited the homepage)
 * is still credited to the page it read.
 *
 * `searchHosts` adds the sites of the search results the run pulled up. The extraction
 * prompt tells the model to cite a result's URL for a fact it saw only in that result's
 * snippet, so those hosts must count as seen too — otherwise a real value the run
 * genuinely found is nulled just because its page was never fully fetched. An off-site
 * citation the run never saw at all is still rejected, and per-value truth is unaffected:
 * the scalar and value guards check each value against the gathered evidence separately.
 */
export const groundedCitationTest = (
	sources: ReadonlyArray<{
		readonly localRef: string
		readonly sourceId: string
	}>,
	searchHosts: ReadonlyArray<string> = [],
): ((sourceId: string) => boolean) => {
	const keys = new Set<string>()
	const hosts = new Set<string>()
	for (const source of sources) {
		keys.add(canonicalizeUrl(source.localRef))
		keys.add(source.sourceId)
		const host = hostOf(source.localRef)
		if (host !== null) hosts.add(host)
	}
	for (const searchHost of searchHosts) {
		const host = hostOf(searchHost)
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
	const drops: CitationDrop[] = []

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
				drops.push({
					field: key ?? 'field',
					value: boundDropValue(record.value),
					sourceId: record.source_id,
				})
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

	return { findings: walk(findings), total, kept, drops }
}
