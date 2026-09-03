import { Atom } from 'effect/unstable/reactivity'

import type { AttentionFilter, CompanySort } from '@batuda/domain'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	firstPage,
	type ListPage,
	listPageKey,
	listPageQuery,
} from '#/lib/list-page'

/**
 * Shape of the validated `/companies` search params: the company filters this
 * screen offers, each present only when set. Keeping the shape canonical (no
 * `undefined` literals, no empty strings) is what makes the cache key below
 * stable across equivalent searches, so a field added here has to be added to
 * that key too or two different searches will answer to one entry.
 */
export type CompaniesSearch = {
	// Four of these hold a list and match any of the values in it, while
	// different filters still narrow one another. `tags` is the exception and
	// reads the other way round: every tag has to be on the company.
	readonly status?: ReadonlyArray<string>
	readonly country?: ReadonlyArray<string>
	readonly industry?: string
	readonly priority?: number
	// User ids, and/or the word 'none' for the companies nobody has taken.
	readonly owner?: ReadonlyArray<string>
	// What a research run concluded about whether the company is worth selling
	// to. Free text on the row, so the menu comes from what is actually stored.
	readonly fitVerdict?: ReadonlyArray<string>
	readonly tags?: ReadonlyArray<string>
	readonly sort?: CompanySort
	readonly query?: string
	// What needs doing, in the dashboard's own words: a missed follow-up, a
	// company gone quiet, or one with nothing planned. Arriving here from a
	// dashboard heading sets this, and the threshold it was showing rides along.
	readonly attention?: AttentionFilter
	readonly staleDays?: number
	// The companies taken out of view, which is how one is found again to be put
	// back. Absent means the ones in use.
	readonly deleted?: 'only'
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
 *   - the order of the values inside one filter, and any blanks among them
 *   - empty-string and empty-list values (treated as absent, same as undefined)
 *   - nullish values
 *
 * Every field the search holds is read, rather than a list kept in step by
 * hand: a filter left out of that list would answer to another filter's key, and
 * two different searches would quietly share one entry.
 *
 * Sorting the values inside a filter is what makes `?tags=a,b` and `?tags=b,a`
 * one list rather than two atoms fetching the same rows twice.
 */
export function canonicalSearchKey(search: CompaniesSearch): string {
	const entries: Array<[string, string | number]> = []
	for (const [key, raw] of Object.entries(search)) {
		if (raw === undefined || raw === null || raw === '') continue
		if (Array.isArray(raw)) {
			const values = (raw as ReadonlyArray<string>)
				.filter(value => value !== '')
				.slice()
				.sort()
			if (values.length === 0) continue
			entries.push([key, values.join(',')])
			continue
		}
		entries.push([key, raw as string | number])
	}
	entries.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(Object.fromEntries(entries))
}
