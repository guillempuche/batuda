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

export const EMAILS_PAGE_SIZE = 100

const cache = new Map<string, ReturnType<typeof makeListAtom>>()

function makeListAtom(search: EmailsSearch) {
	const query: Record<string, string | number> = {}
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
	if (search.limit !== undefined) query['limit'] = search.limit
	if (search.offset !== undefined) query['offset'] = search.offset
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

export const inboxesListAtom = ForjaApiAtom.query('email', 'listInboxes', {
	query: {},
})

/**
 * Id-keyed atom factory. The same `threadId` must return the same atom
 * identity so SSR hydration lands on the atom the component subscribes
 * to.
 */
const threadCache = new Map<string, ReturnType<typeof makeThreadAtom>>()
function makeThreadAtom(threadId: string) {
	return ForjaApiAtom.query('email', 'getThread', {
		params: { threadId },
	})
}
export function threadAtomFor(threadId: string) {
	const existing = threadCache.get(threadId)
	if (existing !== undefined) return existing
	const atom = makeThreadAtom(threadId)
	threadCache.set(threadId, atom)
	return atom
}

// Module-scoped mutation atoms — a single writable setter instance is
// shared across every component that fires the same mutation.
export const sendEmailAtom = ForjaApiAtom.mutation('email', 'send')
export const replyEmailAtom = ForjaApiAtom.mutation('email', 'reply')

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

export const createInboxAtom = ForjaApiAtom.mutation('email', 'createInbox')
export const updateInboxAtom = ForjaApiAtom.mutation('email', 'updateInbox')
export const syncInboxesAtom = ForjaApiAtom.mutation('email', 'syncInboxes')

// ── Drafts ──
export const createDraftAtom = ForjaApiAtom.mutation('email', 'createDraft')
export const updateDraftAtom = ForjaApiAtom.mutation('email', 'updateDraft')
export const deleteDraftAtom = ForjaApiAtom.mutation('email', 'deleteDraft')
export const sendDraftAtom = ForjaApiAtom.mutation('email', 'sendDraft')
export const listDraftsAtom = ForjaApiAtom.query('email', 'listDrafts', {
	query: {},
})

// ── Footers ──
export const createFooterAtom = ForjaApiAtom.mutation('email', 'createFooter')
export const updateFooterAtom = ForjaApiAtom.mutation('email', 'updateFooter')
export const deleteFooterAtom = ForjaApiAtom.mutation('email', 'deleteFooter')

const footerCache = new Map<string, ReturnType<typeof makeFooterAtom>>()
function makeFooterAtom(inboxId: string) {
	return ForjaApiAtom.query('email', 'listFooters', {
		params: { inboxId },
	})
}
export function footersAtomFor(inboxId: string) {
	const existing = footerCache.get(inboxId)
	if (existing !== undefined) return existing
	const atom = makeFooterAtom(inboxId)
	footerCache.set(inboxId, atom)
	return atom
}
