import type { CompaniesSearch } from '#/atoms/companies-atoms'

/**
 * The filters as a query string, for a link built by hand.
 *
 * Every field the search holds is written out, rather than a list of names kept
 * in step by hand: a filter left off that list is dropped from the link, so
 * arriving from a dashboard heading and switching view would silently widen the
 * list, and switching back would not put it right.
 *
 * A filter holding several values travels comma-separated — the form the server
 * reads, and the one a person can type.
 */
export function companiesSearchToQuery(search: CompaniesSearch): string {
	const params = new URLSearchParams()
	for (const [key, raw] of Object.entries(search)) {
		if (raw === undefined || raw === null || raw === '') continue
		if (Array.isArray(raw)) {
			const values = (raw as ReadonlyArray<string>).filter(
				value => value !== '',
			)
			if (values.length === 0) continue
			params.set(key, values.join(','))
			continue
		}
		params.set(key, String(raw))
	}
	const query = params.toString()
	return query === '' ? '' : `?${query}`
}

const ATTRIBUTE_PARAMS = [
	'attributeKey',
	'attributeOp',
	'attributeValue',
] as const

export type AttributeFilterSearch = {
	readonly attributeKey?: string
	readonly attributeOp?: string
	readonly attributeValue?: string
}

/**
 * The words of a "one of" list: trimmed, the empties dropped, each word once,
 * in one order.
 *
 * One spelling per filter. A list typed by hand, one ticked in the control and
 * one kept in a saved view all come out the same, so a filter cannot answer to
 * two cache entries or read as two different saved views.
 */
export function canonicalWords(
	raw: string | ReadonlyArray<string>,
): ReadonlyArray<string> {
	const parts = typeof raw === 'string' ? raw.split(',') : raw
	return [
		...new Set(parts.map(part => part.trim()).filter(part => part !== '')),
	].sort()
}

/**
 * The attribute filter is three params that mean something only together: the
 * key, how to compare, and what against. A link or a saved view carrying two of
 * them would send an incomplete filter the server refuses, so the three are
 * dropped as one unless all three are there.
 *
 * A "one of" list arrives canonical and a single value trimmed, so two
 * spellings of one filter share a cache entry and a saved view matches the list
 * it was saved from.
 */
export function normaliseAttributeFilter<S extends object>(search: S): S {
	const { attributeKey, attributeOp, attributeValue, ...rest } = search as S &
		AttributeFilterSearch
	// Dropped by name rather than by leaving the key out: the router lays the
	// validated search over the raw address, so a key merely missing here comes
	// back from the address and reaches the server after all. Only the names the
	// address actually carries are covered, or a search with no attribute filter
	// would come away holding three of them, and anything counting what is set
	// would read that as a filter.
	const dropped = { ...rest } as Record<string, unknown>
	for (const name of ATTRIBUTE_PARAMS) {
		if (name in search) dropped[name] = undefined
	}
	if (
		attributeKey === undefined ||
		attributeOp === undefined ||
		attributeValue === undefined
	) {
		return dropped as S
	}
	const value =
		attributeOp === 'in'
			? canonicalWords(attributeValue).join(',')
			: attributeValue.trim()
	if (value === '') return dropped as S
	return { ...rest, attributeKey, attributeOp, attributeValue: value } as S
}
