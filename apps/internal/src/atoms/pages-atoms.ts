import { ForjaApiAtom } from '#/lib/forja-api-atom'

export type PagesSearch = {
	readonly companyId?: string
	readonly status?: string
	readonly lang?: string
}

const listCache = new Map<string, ReturnType<typeof makeListAtom>>()
const detailCache = new Map<string, ReturnType<typeof makeDetailAtom>>()

function makeListAtom(search: PagesSearch) {
	return ForjaApiAtom.query('pages', 'list', { query: search })
}

function makeDetailAtom(id: string) {
	return ForjaApiAtom.query('pages', 'get', { params: { id } })
}

export function pagesSearchAtom(search: PagesSearch) {
	const key = canonicalKey(search)
	const existing = listCache.get(key)
	if (existing !== undefined) return existing
	const atom = makeListAtom(search)
	listCache.set(key, atom)
	return atom
}

export function pageAtomFor(id: string) {
	const existing = detailCache.get(id)
	if (existing !== undefined) return existing
	const atom = makeDetailAtom(id)
	detailCache.set(id, atom)
	return atom
}

export function canonicalKey(search: PagesSearch): string {
	const entries: Array<[string, string]> = []
	if (search.companyId !== undefined && search.companyId !== '') {
		entries.push(['companyId', search.companyId])
	}
	if (search.status !== undefined && search.status !== '') {
		entries.push(['status', search.status])
	}
	if (search.lang !== undefined && search.lang !== '') {
		entries.push(['lang', search.lang])
	}
	entries.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(Object.fromEntries(entries))
}
