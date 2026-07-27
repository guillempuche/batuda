import { Atom } from 'effect/unstable/reactivity'

import type { DocumentSubjectTable, DocumentType } from '@batuda/domain'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	firstPage,
	type ListPage,
	listPageKey,
	listPageQuery,
} from '#/lib/list-page'

/**
 * Queries for documents, cached by what they ask for.
 *
 * The cache is what lets a page rendered on the server hand its answer to the
 * browser: both sides have to reach for the same query object, and building a
 * fresh one each render would give them two.
 */

const detailCache = new Map<string, ReturnType<typeof makeDetailAtom>>()

function makeDetailAtom(id: string) {
	return BatudaApiAtom.query('documents', 'get', {
		params: { id },
		serializationKey: `document:${id}`,
	})
}

export function documentAtomFor(id: string) {
	const existing = detailCache.get(id)
	if (existing !== undefined) return existing
	const atom = makeDetailAtom(id)
	detailCache.set(id, atom)
	return atom
}

/** What narrows a list of documents: the record they hang off, or a search. */
export type DocumentsSearch = {
	readonly subjectTable?: DocumentSubjectTable
	readonly subjectId?: string
	readonly type?: DocumentType
	readonly q?: string
}

/** How many documents the standalone documents screen reads at a time. */
export const DOCUMENTS_PAGE_SIZE = 50

/** How many a record's own Files panel reads at a time. */
export const SUBJECT_DOCUMENTS_PAGE_SIZE = 20

const listCache = new Map<string, ReturnType<typeof makeListAtom>>()

function makeListAtom(search: DocumentsSearch, page: ListPage) {
	const atom = BatudaApiAtom.query('documents', 'list', {
		query: { ...search, ...listPageQuery(page) },
		serializationKey: `documents:list:${documentsSearchKey(search)}::${listPageKey(page)}`,
	})
	// Only the first slice is held: coming back to a record paints its files
	// straight away, while later slices are kept by the list that read them.
	return page.offset === 0 ? Atom.keepAlive(atom) : atom
}

export function documentsListAtom(search: DocumentsSearch, page: ListPage) {
	const key = `${documentsSearchKey(search)}::${listPageKey(page)}`
	const existing = listCache.get(key)
	if (existing !== undefined) return existing
	const atom = makeListAtom(search, page)
	listCache.set(key, atom)
	return atom
}

/** The first slice a record's Files panel asks for. */
export function subjectDocumentsFirstPage(): ListPage {
	return firstPage(SUBJECT_DOCUMENTS_PAGE_SIZE, 'exact')
}

/**
 * A stable key for one set of filters, so two equivalent searches share a
 * cached answer rather than each fetching their own.
 */
export function documentsSearchKey(search: DocumentsSearch): string {
	const entries: Array<[string, string]> = []
	if (search.subjectTable) entries.push(['subjectTable', search.subjectTable])
	if (search.subjectId) entries.push(['subjectId', search.subjectId])
	if (search.type) entries.push(['type', search.type])
	if (search.q) entries.push(['q', search.q])
	entries.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(Object.fromEntries(entries))
}
