import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { type CompaniesSearch, canonicalSearchKey } from './companies-atoms'

/**
 * The filters a count is asked for: the search minus its sort order, which
 * decides what order companies come back in and never which ones — carrying it
 * would throw the counts away every time somebody reordered the list.
 */
export const facetsQuery = (search: CompaniesSearch): CompaniesSearch => {
	const { sort: _sort, ...rest } = search
	return rest
}

const cache = new Map<string, ReturnType<typeof makeCompanyFacetsAtom>>()

// Not kept alive: the counts are read off the companies themselves, so writing,
// deleting or restoring one makes them wrong and a held answer has no way of
// learning that. The cache above is what stops a re-render asking again.
function makeCompanyFacetsAtom(search: CompaniesSearch, key: string) {
	return BatudaApiAtom.query('companies', 'facets', {
		query: search,
		serializationKey: `companies:facets:${key}`,
	})
}

/**
 * The (memoized) atom for one set of filters, so the screen and anything else
 * asking the same question share an answer instead of each fetching it.
 */
export function companyFacetsAtom(search: CompaniesSearch) {
	const filters = facetsQuery(search)
	const key = canonicalSearchKey(filters)
	const existing = cache.get(key)
	if (existing !== undefined) return existing
	const atom = makeCompanyFacetsAtom(filters, key)
	cache.set(key, atom)
	return atom
}
