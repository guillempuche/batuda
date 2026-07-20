/**
 * A last-resort recovery for the high-value firmographics the broad pass and the
 * focused rescues both left empty.
 *
 * The rescues re-read the evidence the run already gathered; this step goes
 * further and fetches new evidence: for each still-empty high-value field it
 * fires one focused web search, so a fact that was simply not on any page the run
 * reached (a company's headquarters country, its sector, its city, its size) still
 * has a chance to be found. It fires only for fields that are still blank and is
 * capped, so a complete run pays nothing and an all-empty one cannot loop.
 *
 * This module is the pure part — which fields to search for and the query to fire.
 * The search, source linking, and re-extraction happen in the research service,
 * where a recovered value passes the same grounding guards as any other.
 */

import { enrichmentFill } from './extraction-fill'

// The firmographic scalars worth spending an extra search on. `size_range` is also
// nudged during the loop (headcount is rarely on the homepage); the other three
// have no search-backed recovery until now, so an empty one simply stayed empty.
export const HIGH_VALUE_FIELDS: ReadonlyArray<string> = [
	'country',
	'industry',
	'location',
	'size_range',
]

// At most this many extra searches per run: an all-empty profile would otherwise
// fire one per field. Any missing field beyond the cap is left for the operator to
// see in the fill telemetry rather than silently searched.
export const MAX_PER_FIELD_SEARCHES = 3

/** The still-empty high-value fields, in a stable order — the ones a per-field
 * search should try to recover. Empty when the profile is already complete. */
export const needsPerFieldSearch = (
	findings: unknown,
): ReadonlyArray<string> => {
	const missing = new Set(enrichmentFill(findings).missing)
	return HIGH_VALUE_FIELDS.filter(field => missing.has(field))
}

// A short, human-readable label per field, used to phrase the search.
const FIELD_INTENT: Record<string, string> = {
	country: 'head office country',
	industry: 'industry sector',
	location: 'headquarters city address',
	size_range: 'number of employees',
}

/**
 * A focused web-search query for one missing field: the company name (quoted so
 * search treats it as a phrase), the city if one was queried, and the fact wanted.
 * Example: `"Acme Corp" Barcelona number of employees`.
 */
export const perFieldSearchQuery = (
	name: string,
	city: string | undefined,
	field: string,
): string => {
	const intent = FIELD_INTENT[field] ?? field
	const cityPart = city && city.trim() !== '' ? ` ${city.trim()}` : ''
	return `"${name.trim()}"${cityPart} ${intent}`
}

// A field is present only when it carries a non-empty string value; a missing key
// or a `{ value: null }` a guard blanked still counts as empty.
const hasValue = (fieldValue: unknown): boolean =>
	fieldValue !== null &&
	typeof fieldValue === 'object' &&
	typeof (fieldValue as { value?: unknown }).value === 'string' &&
	(fieldValue as { value: string }).value.trim() !== ''

const enrichmentOf = (
	findings: unknown,
): Record<string, unknown> | undefined => {
	if (findings === null || typeof findings !== 'object') return undefined
	const enrichment = (findings as { enrichment?: unknown }).enrichment
	return enrichment !== null && typeof enrichment === 'object'
		? (enrichment as Record<string, unknown>)
		: undefined
}

/**
 * Fill the high-value fields from a re-extraction over the enlarged evidence, but
 * only where the first pass left them empty — a value already grounded is never
 * overwritten. Returns the findings and how many fields it filled.
 */
export const mergePerFieldSearch = (
	findings: unknown,
	refreshed: unknown,
): { readonly findings: unknown; readonly filled: number } => {
	const enrichment = enrichmentOf(findings)
	const refreshedEnrichment = enrichmentOf(refreshed)
	if (enrichment === undefined || refreshedEnrichment === undefined) {
		return { findings, filled: 0 }
	}
	let filled = 0
	const nextEnrichment: Record<string, unknown> = { ...enrichment }
	for (const key of HIGH_VALUE_FIELDS) {
		if (!hasValue(enrichment[key]) && hasValue(refreshedEnrichment[key])) {
			nextEnrichment[key] = refreshedEnrichment[key]
			filled++
		}
	}
	if (filled === 0) return { findings, filled: 0 }
	return {
		findings: { ...(findings as object), enrichment: nextEnrichment },
		filled,
	}
}
