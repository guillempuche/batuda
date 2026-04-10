import { ForjaApiAtom } from '#/lib/forja-api-atom'

/**
 * Shape of the validated `/companies` search params. Mirrors the query
 * schema in `packages/controllers/src/routes/companies.ts:62` — every
 * field is optional and only present when set. Keeping this shape
 * canonical (no `undefined` literals, no empty strings) makes the
 * cache-key helper below stable across equivalent searches.
 */
export type CompaniesSearch = {
	readonly status?: string
	readonly region?: string
	readonly industry?: string
	readonly priority?: number
	readonly query?: string
}

/**
 * Cache of `ForjaApiAtom.query('companies', 'list', ...)` atoms keyed by
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

function makeCompaniesSearchAtom(search: CompaniesSearch) {
	return ForjaApiAtom.query('companies', 'list', { query: search })
}

/**
 * Return the (memoized) atom for the given search. Called from:
 *   - the route loader, which hydrates the atom with server-fetched data
 *   - the route component, which reads the atom via `useAtomValue`
 *
 * Because both sides hit the same cache with the same canonical key,
 * hydration actually lands on the atom the component will observe.
 */
export function companiesSearchAtom(search: CompaniesSearch) {
	const key = canonicalSearchKey(search)
	const existing = cache.get(key)
	if (existing !== undefined) return existing
	const atom = makeCompaniesSearchAtom(search)
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
	if (search.region !== undefined && search.region !== '') {
		entries.push(['region', search.region])
	}
	if (search.industry !== undefined && search.industry !== '') {
		entries.push(['industry', search.industry])
	}
	if (search.priority !== undefined) {
		entries.push(['priority', search.priority])
	}
	if (search.query !== undefined && search.query !== '') {
		entries.push(['query', search.query])
	}
	entries.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(Object.fromEntries(entries))
}
