import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

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
 * Page size for the list + board "load more": the initial window and the number
 * of rows each "load more" adds. The growing window is part of the atom cache
 * key (see below), so each step fetches its own cached result and hydrates on
 * SSR for the first page.
 */
export const COMPANIES_PAGE_SIZE = 60

function makeCompaniesSearchAtom(search: CompaniesSearch, limit: number) {
	// Held even while nothing is showing it, so stepping into a company and
	// coming back puts the same rows straight back on screen instead of
	// refetching them and collapsing the list to a single page in between.
	return Atom.keepAlive(
		BatudaApiAtom.query('companies', 'list', {
			query: { ...search, limit },
			serializationKey: `companies:search:${canonicalSearchKey(search)}::${limit}`,
		}),
	)
}

/**
 * Return the (memoized) atom for the given search. Called from:
 *   - the route loader, which hydrates the atom with server-fetched data
 *   - the route component, which reads the atom via `useAtomValue`
 *
 * Because both sides hit the same cache with the same canonical key,
 * hydration actually lands on the atom the component will observe.
 */
export function companiesSearchAtom(
	search: CompaniesSearch,
	limit: number = COMPANIES_PAGE_SIZE,
) {
	// The visible window is part of the identity so "load more" (a larger limit)
	// resolves to its own cached atom instead of mutating the current one.
	const key = `${canonicalSearchKey(search)}::${limit}`
	const existing = cache.get(key)
	if (existing !== undefined) return existing
	const atom = makeCompaniesSearchAtom(search, limit)
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
	entries.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(Object.fromEntries(entries))
}
