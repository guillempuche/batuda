/**
 * Helpers for the open-ended discovery scans (prospect / competitor). These are
 * the only schemas where a short primary list says the search fell short rather
 * than the data, so they alone earn a refined retry and, if still empty, an
 * honest terminal status instead of a green "succeeded" over nothing.
 *
 * The list of scan schemas below is the only one: every question asked about a
 * scan — here and in the quality signal — reads it, so no second copy can name
 * one scan schema and quietly grade the other as having found nothing.
 */

import { unwrapValue } from './guard-shapes'

// The primary result array for each discovery-scan schema. A schema absent here
// is not a discovery scan: it keeps whatever it found and is never retried.
const DISCOVERY_RESULT_FIELD: Record<string, string> = {
	prospect_scan_v1: 'prospects',
	competitor_scan_v1: 'competitors',
}

/**
 * How many results a scan has to come back with before its list reads as a list.
 * A scan is asked for breadth — a set of companies to work through — so anything
 * under a handful is a lead or two, and far more often the search fell short than
 * the market did. Below this a scan earns the refined retry and finishes marked
 * for a read; only an outright empty list is reported as nothing found.
 */
export const DISCOVERY_THIN_RESULT_COUNT = 5

/** Whether a schema is an open-ended discovery scan. */
export const isDiscoveryScan = (schemaName: string): boolean =>
	schemaName in DISCOVERY_RESULT_FIELD

/**
 * Which list holds a discovery scan's companies, or undefined for a schema that
 * is not a scan. Anything that needs to reach inside a scan's results asks here,
 * so the mapping above stays the only place the two schemas are named.
 */
export const discoveryResultField = (schemaName: string): string | undefined =>
	DISCOVERY_RESULT_FIELD[schemaName]

/**
 * The companies a discovery scan came back with, as rows to read fields off.
 * Empty for anything that is not a scan, and for a scan whose list is missing or
 * unusable — so a caller reads a scan's answer without naming the list itself,
 * which keeps the mapping above the only place the two schemas are named.
 */
export const discoveryRows = (
	schemaName: string | undefined,
	findings: unknown,
): ReadonlyArray<Record<string, unknown>> => {
	const field =
		schemaName === undefined ? undefined : DISCOVERY_RESULT_FIELD[schemaName]
	if (field === undefined) return []
	if (findings === null || typeof findings !== 'object') return []
	const rows = (findings as Record<string, unknown>)[field]
	if (!Array.isArray(rows)) return []
	return rows.filter(
		(row): row is Record<string, unknown> =>
			row !== null && typeof row === 'object' && !Array.isArray(row),
	)
}

// Where a scan's row says what it does. A prospect gives the industry it was
// filed under and why it matched; a competitor gives a description instead.
//
// The relevance note is read even though it is the field most likely to repeat the
// request back, because leaving it out reads worse. It is the only one of the three a
// prospect row must fill: on a live pass 24 of 53 rows stated a trade and every other
// row said what it did only there, so without it more than half a list says nothing
// at all and any reading built on this turns into a reading of how often an optional
// field got filled.
//
// What that costs is stated plainly: a row naming several trades counts towards each
// one. That is right for an installer who genuinely does them all — the live pass has
// rows authorised for four — and generous towards a row that merely lists back what
// was asked for. Anything counted off these fields is therefore an upper bound. The
// failure worth catching survives it, because a trade no row mentions at all still
// reads as unanswered.
const TRADE_FIELDS = ['industry', 'why_relevant', 'description'] as const

/** A field's value, or null when it is missing or says nothing. */
const readFilled = (raw: unknown): string | null => {
	const inner = unwrapValue(raw)
	if (typeof inner !== 'string') return null
	const trimmed = inner.trim()
	return trimmed === '' ? null : trimmed
}

/** What one of a scan's rows says it does, run together as one piece of text. */
export const discoveryRowDescription = (row: Record<string, unknown>): string =>
	TRADE_FIELDS.map(field => readFilled(row[field]))
		.filter(value => value !== null)
		.join(' ')

/**
 * Everything one of a scan's rows says about itself in words: its name, and where
 * it says what it does. A company named for its trade — "Ascensores Girona" —
 * says which trade it is in nowhere else, so the name belongs in the reading.
 */
export const discoveryRowText = (row: Record<string, unknown>): string =>
	[readFilled(row['name']), discoveryRowDescription(row)]
		.filter(value => value !== null && value !== '')
		.join(' ')

/**
 * How many results a discovery scan's primary list carries. Null for a schema
 * that is not a discovery scan, whose result count is a different question its
 * own guards answer; zero when the list is missing, unusable, or empty.
 */
export const discoveryResultCount = (
	schemaName: string,
	findings: unknown,
): number | null => {
	const field = DISCOVERY_RESULT_FIELD[schemaName]
	if (field === undefined) return null
	if (
		findings == null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	)
		return 0
	const value = (findings as Record<string, unknown>)[field]
	return Array.isArray(value) ? value.length : 0
}

/**
 * Whether a discovery scan's findings carry no results — an empty or missing
 * primary list, or a non-object findings value. Always false for a non-discovery
 * schema, whose emptiness is a different question its own guards answer.
 */
export const isDiscoveryScanEmpty = (
	schemaName: string,
	findings: unknown,
): boolean => discoveryResultCount(schemaName, findings) === 0

/**
 * Whether a discovery scan came back with too few results to read as the list it
 * was asked for. True of an empty scan as well: nothing found is the thinnest
 * result there is.
 */
export const isDiscoveryScanThin = (
	schemaName: string,
	findings: unknown,
): boolean => {
	const count = discoveryResultCount(schemaName, findings)
	return count !== null && count < DISCOVERY_THIN_RESULT_COUNT
}

// Appended to the query for a single refined retry after a discovery scan comes
// back thin, steering the model toward useful sources and away from the social /
// glossary noise that empties an open-ended search — while holding it to the
// request's own size, place, and niche so "refine" widens the wording, not the bar.
// It says "too few" rather than "none" because the retry also fires on a handful
// of results, and the first pass's results are kept alongside whatever it adds.
export const REFINE_HINT =
	'The previous search returned too few relevant results. Refine your approach: search business directories, industry association member lists, and sector-specific registries for companies that match the criteria; combine specific location and industry keywords; and ignore social-media posts, forums, and glossary pages. Do not use placeholder site: filters. Keep every qualifier the request made — size, place, and niche: widen the wording, never the criteria. A "top N" or "largest" ranking is not a shortcut past them; it lists the biggest firms in the sector, which is rarely what was asked.'

/**
 * What a discovery scan that found nothing reports in place of findings. The
 * refined retry is mentioned only when the run actually got one — a scan can
 * finish its first pass with too little budget left for a second — so a run that
 * searched once never reads as though it had tried twice and given up.
 */
export const emptyScanFindings = (
	refined: boolean,
): { readonly error: string; readonly reason: 'no_reliable_data' } => ({
	error: refined
		? 'The search found no companies matching the criteria, even after a refined retry, so there are no reliable findings to report.'
		: 'The search found no companies matching the criteria, so there are no reliable findings to report.',
	reason: 'no_reliable_data',
})
