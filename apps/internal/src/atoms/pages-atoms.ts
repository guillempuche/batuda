import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	firstPage,
	type ListPage,
	listPageKey,
	listPageQuery,
} from '#/lib/list-page'

export type PagesSearch = {
	readonly companyId?: string
	readonly status?: string
	readonly lang?: string
}

const listCache = new Map<string, ReturnType<typeof makeListAtom>>()
const detailCache = new Map<string, ReturnType<typeof makeDetailAtom>>()

/** How many pages the pages screen and the Files tab read at a time. */
export const PAGES_PAGE_SIZE = 60

/** The slice both a loader and a screen ask for first. */
export const PAGES_FIRST_PAGE = firstPage(PAGES_PAGE_SIZE, 'exact')

function makeListAtom(search: PagesSearch, page: ListPage) {
	const atom = BatudaApiAtom.query('pages', 'list', {
		// The first slice is counted because both the Files tab's badge and the
		// pages screen's own heading state how many there are.
		query: { ...search, ...listPageQuery(page) },
		serializationKey: `pages:list:${canonicalKey(search)}::${listPageKey(page)}`,
	})
	return page.offset === 0 ? Atom.keepAlive(atom) : atom
}

function makeDetailAtom(id: string) {
	return BatudaApiAtom.query('pages', 'get', {
		params: { id },
		serializationKey: `page:${id}`,
	})
}

export function pagesSearchAtom(
	search: PagesSearch,
	page: ListPage = PAGES_FIRST_PAGE,
) {
	const key = `${canonicalKey(search)}::${listPageKey(page)}`
	const existing = listCache.get(key)
	if (existing !== undefined) return existing
	const atom = makeListAtom(search, page)
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
