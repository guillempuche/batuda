import { ForjaApiAtom } from '#/lib/forja-api-atom'

/**
 * Canonical shape for the `/emails` search params. Mirrors the envelope
 * query schema in `packages/controllers/src/routes/email.ts` — every
 * field is optional and only present when set. Keeping this shape strict
 * (no `undefined` literals, no empty strings) makes the cache-key helper
 * stable across equivalent searches.
 */
export type EmailsSearch = {
	readonly inboxId?: string
	readonly companyId?: string
	readonly status?: 'open' | 'closed' | 'archived'
	readonly purpose?: 'human' | 'agent' | 'shared'
	readonly query?: string
	readonly limit?: number
	readonly offset?: number
}

/** Page size for the list view — plan pegs this at 100 / page. */
export const EMAILS_PAGE_SIZE = 100

const cache = new Map<string, ReturnType<typeof makeListAtom>>()

function makeListAtom(search: EmailsSearch) {
	// The atom reads string values for numeric fields because the query
	// schema uses `Schema.NumberFromString`. Serialize here so the request
	// payload matches the wire format.
	const query: Record<string, string> = {}
	if (search.inboxId !== undefined && search.inboxId !== '') {
		query['inboxId'] = search.inboxId
	}
	if (search.companyId !== undefined && search.companyId !== '') {
		query['companyId'] = search.companyId
	}
	if (search.status !== undefined) query['status'] = search.status
	if (search.purpose !== undefined) query['purpose'] = search.purpose
	if (search.query !== undefined && search.query !== '') {
		query['query'] = search.query
	}
	if (search.limit !== undefined) query['limit'] = String(search.limit)
	if (search.offset !== undefined) query['offset'] = String(search.offset)
	return ForjaApiAtom.query('email', 'listThreads', { query })
}

export function emailsSearchAtom(search: EmailsSearch) {
	const key = canonicalKey(search)
	const existing = cache.get(key)
	if (existing !== undefined) return existing
	const atom = makeListAtom(search)
	cache.set(key, atom)
	return atom
}

export function canonicalKey(search: EmailsSearch): string {
	const entries: Array<[string, string | number]> = []
	if (search.inboxId !== undefined && search.inboxId !== '') {
		entries.push(['inboxId', search.inboxId])
	}
	if (search.companyId !== undefined && search.companyId !== '') {
		entries.push(['companyId', search.companyId])
	}
	if (search.status !== undefined) entries.push(['status', search.status])
	if (search.purpose !== undefined) entries.push(['purpose', search.purpose])
	if (search.query !== undefined && search.query !== '') {
		entries.push(['query', search.query])
	}
	if (search.limit !== undefined) entries.push(['limit', search.limit])
	if (search.offset !== undefined) entries.push(['offset', search.offset])
	entries.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(Object.fromEntries(entries))
}

/** Module-scoped atom for the list of inboxes shown in the inbox picker. */
export const inboxesListAtom = ForjaApiAtom.query('email', 'listInboxes', {
	query: {},
})

/**
 * Mutation atoms for thread state changes. Held at module scope so every
 * render (the list page, the bulk toolbar, the row context menu) shares
 * a single writable setter instance.
 */
export const updateThreadStatusAtom = ForjaApiAtom.mutation(
	'email',
	'updateThreadStatus',
)
export const markThreadReadAtom = ForjaApiAtom.mutation(
	'email',
	'markThreadRead',
)
export const markThreadUnreadAtom = ForjaApiAtom.mutation(
	'email',
	'markThreadUnread',
)
