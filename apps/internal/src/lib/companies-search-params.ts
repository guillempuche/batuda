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
