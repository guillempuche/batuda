import { Atom } from 'effect/unstable/reactivity'

import type { AttentionFilter } from '@batuda/domain'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	firstPage,
	type ListPage,
	listPageKey,
	listPageQuery,
} from '#/lib/list-page'

/**
 * Shape of the validated `/companies` search params. Mirrors the query
 * schema in `packages/controllers/src/routes/companies.ts:62` — every
 * field is optional and only present when set. Keeping this shape
 * canonical (no `undefined` literals, no empty strings) makes the
 * cache-key helper below stable across equivalent searches.
 */
export type CompaniesSearch = {
	readonly status?: string
	readonly country?: string
	readonly industry?: string
	readonly priority?: number
	readonly owner?: string
	readonly sort?: string
	readonly query?: string
	// What needs doing, in the dashboard's own words: a missed follow-up, a
	// company gone quiet, or one with nothing planned. Arriving here from a
	// dashboard heading sets this, and the threshold it was showing rides along.
	readonly attention?: AttentionFilter
	readonly staleDays?: number
	// 'only' asks for the companies taken out of view, which is how one is found
	// again to be put back. Absent means the ones in use.
	readonly deleted?: 'only' | 'include'
}

/**
 * Cache of `BatudaApiAtom.query('companies', 'list', ...)` atoms keyed by
 * a stable stringification of the search. Both the route loader (SSR)
 * and the component (client) go through this factory so they get the
 * *same* atom identity for the *same* search, which lets
 * `RegistryProvider.initialValues` seed the atom the component will read.
 *
 * We cache ourselves (rather than relying on `AtomHttpApi`'s internal
 * family) because we want strict control over the cache key — two
 * search objects that differ only in key order or in an empty-string
 * placeholder must produce one entry.
 */
const cache = new Map<string, ReturnType<typeof makeCompaniesSearchAtom>>()

/**
 * How many companies the list and each board column read at a time, and how
 * many each "load more" adds.
 */
export const COMPANIES_PAGE_SIZE = 60

/** The slice both the loader and the screen ask for first. */
export const COMPANIES_FIRST_PAGE = firstPage(COMPANIES_PAGE_SIZE, 'exact')

function makeCompaniesSearchAtom(search: CompaniesSearch, page: ListPage) {
	const atom = BatudaApiAtom.query('companies', 'list', {
		// The first slice is counted because the screen states how many
		// companies match; later slices are not, since that number does not
		// change as the reader moves down the list.
		query: { ...search, ...listPageQuery(page) },
		serializationKey: `companies:search:${canonicalSearchKey(search)}::${listPageKey(page)}`,
	})
	// The first slice is held even while nothing is showing it, so stepping
	// into a company and coming back paints immediately instead of fetching
	// again. Later slices are not: their rows are kept by the list itself, and
	// holding every slice of every list ever scrolled would pin them all for
	// the life of the tab.
	return page.offset === 0 ? Atom.keepAlive(atom) : atom
}

/**
 * Return the (memoized) atom for the given search and slice. Called from:
 *   - the route loader, which hydrates the atom with server-fetched data
 *   - the route component, which reads the atom via `useAtomValue`
 *
 * Because both sides hit the same cache with the same canonical key,
 * hydration actually lands on the atom the component will observe.
 */
export function companiesSearchAtom(
	search: CompaniesSearch,
	page: ListPage = COMPANIES_FIRST_PAGE,
) {
	// The slice is part of the identity, so each one resolves to its own
	// cached atom instead of overwriting the one before it.
	const key = `${canonicalSearchKey(search)}::${listPageKey(page)}`
	const existing = cache.get(key)
	if (existing !== undefined) return existing
	const atom = makeCompaniesSearchAtom(search, page)
	cache.set(key, atom)
	return atom
}

/**
 * Produce a stable cache key from a search object. Normalizes away:
 *   - key order (`{a,b}` vs `{b,a}`) via sorted keys
 *   - empty-string values (treated as absent, same as undefined)
 *   - nullish values
 *
 * Using `JSON.stringify` on a sorted plain object gives identical keys
 * for identical searches without pulling in a stable-stringify dep.
 */
export function canonicalSearchKey(search: CompaniesSearch): string {
	const entries: Array<[string, string | number]> = []
	if (search.status !== undefined && search.status !== '') {
		entries.push(['status', search.status])
	}
	if (search.country !== undefined && search.country !== '') {
		entries.push(['country', search.country])
	}
	if (search.industry !== undefined && search.industry !== '') {
		entries.push(['industry', search.industry])
	}
	if (search.priority !== undefined) {
		entries.push(['priority', search.priority])
	}
	if (search.owner !== undefined && search.owner !== '') {
		entries.push(['owner', search.owner])
	}
	if (search.sort !== undefined && search.sort !== '') {
		entries.push(['sort', search.sort])
	}
	if (search.query !== undefined && search.query !== '') {
		entries.push(['query', search.query])
	}
	if (search.attention !== undefined) {
		entries.push(['attention', search.attention])
	}
	if (search.staleDays !== undefined) {
		entries.push(['staleDays', search.staleDays])
	}
	// Part of the key, not just the query: the deleted companies and the ones in
	// use are two different lists. Left out, both answer to the same key and
	// asking for one serves whatever the other last fetched.
	if (search.deleted !== undefined) {
		entries.push(['deleted', search.deleted])
	}
	entries.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(Object.fromEntries(entries))
}
