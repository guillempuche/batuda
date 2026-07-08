/**
 * Helpers for the open-ended discovery scans (prospect / competitor). These are
 * the only schemas whose empty primary list means the search — not the data —
 * came up short, so they alone earn a refined retry and, if still empty, an
 * honest terminal status instead of a green "succeeded" over nothing.
 */

// The primary result array for each discovery-scan schema. A schema absent here
// is not a discovery scan: it keeps whatever it found and is never retried.
const DISCOVERY_RESULT_FIELD: Record<string, string> = {
	prospect_scan_v1: 'prospects',
	competitor_scan_v1: 'competitors',
}

/** Whether a schema is an open-ended discovery scan eligible for the retry. */
export const isRetryEligible = (schemaName: string): boolean =>
	schemaName in DISCOVERY_RESULT_FIELD

/**
 * Whether a discovery scan's findings carry no results — an empty or missing
 * primary list, or a non-object findings value. Always false for a non-discovery
 * schema, whose emptiness is a different question its own guards answer.
 */
export const isDiscoveryScanEmpty = (
	schemaName: string,
	findings: unknown,
): boolean => {
	const field = DISCOVERY_RESULT_FIELD[schemaName]
	if (field === undefined) return false
	if (
		findings == null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	)
		return true
	const value = (findings as Record<string, unknown>)[field]
	return !Array.isArray(value) || value.length === 0
}

// Appended to the query for a single refined retry after a discovery scan comes
// back empty, steering the model toward useful sources and away from the social /
// glossary noise that empties an open-ended search.
export const REFINE_HINT =
	'The previous search returned no relevant results. Refine your approach: search business directories, industry association member lists, and sector-specific registries for companies that match the criteria; combine specific location and industry keywords; and ignore social-media posts, forums, and glossary pages. Do not use placeholder site: filters.'
