import type { ThreadSort, ThreadStatus, ThreadWaitingOn } from '@batuda/domain'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Canonical shape for the `/emails` search params. Mirrors the thread-list
 * query in `packages/controllers/src/routes/email.ts` — every field is optional
 * and only present when set.
 *
 * Keeping this shape strict (no `undefined` literals, no empty strings, no
 * empty lists) is what makes the cache key below stable: two searches that
 * narrow the list the same way have to answer to one entry, or the same rows
 * are fetched twice under two names.
 *
 * A field added here needs nothing added beside it — the key and the request
 * both read whatever the search holds rather than a list of names kept in step
 * by hand.
 */
export type EmailsSearch = {
	readonly inboxId?: string
	readonly companyId?: string
	readonly contactId?: string
	// Several stages at once: a conversation matching any of them is on the
	// list, which is how "open or closed but not archived" is asked for.
	readonly status?: ReadonlyArray<ThreadStatus>
	readonly waitingOn?: ThreadWaitingOn
	// The words the server reads, not a yes/no: a query string carries text, and
	// the endpoint holds these two to 'true' or 'false' rather than guessing at
	// whatever else a link might spell.
	readonly unread?: 'true' | 'false'
	readonly hasAttachments?: 'true' | 'false'
	readonly quietDays?: number
	// User ids, and/or the word 'none' for the conversations whose company
	// nobody has taken.
	readonly companyOwner?: ReadonlyArray<string>
	readonly sort?: ThreadSort
	readonly query?: string
	readonly limit?: number
	readonly offset?: number
	readonly count?: 'exact' | 'none'
}

export const EMAILS_PAGE_SIZE = 100

const cache = new Map<string, ReturnType<typeof makeListAtom>>()

function makeListAtom(search: EmailsSearch) {
	return BatudaApiAtom.query('email', 'listThreads', {
		// Handed over whole rather than copied field by field: a field missed in
		// the copying is a filter the server never hears about, so the list comes
		// back unfiltered under a cache key that says it was filtered.
		query: search,
		serializationKey: `email:threads:${canonicalKey(search)}`,
	})
}

export function emailsSearchAtom(search: EmailsSearch) {
	const key = canonicalKey(search)
	const existing = cache.get(key)
	if (existing !== undefined) return existing
	const atom = makeListAtom(search)
	cache.set(key, atom)
	return atom
}

/**
 * A stable cache key for a search. Normalises away key order, the order of the
 * values inside one filter and any blanks among them, and treats an empty
 * string or an empty list as absent.
 *
 * Sorting the values inside a filter is what makes `?status=open,closed` and
 * `?status=closed,open` one list rather than two atoms fetching the same rows
 * twice.
 *
 * Two requests that differ only in whether they asked to be counted come back
 * with different answers, so `count` is part of the key like everything else.
 */
export function canonicalKey(search: EmailsSearch): string {
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

export const inboxesListAtom = BatudaApiAtom.query('email', 'listInboxes', {
	// Removed mailboxes keep their row so old threads still resolve through
	// them, but they are gone as far as anyone managing mailboxes is
	// concerned — otherwise removing one looks like it did nothing.
	query: { active: 'true' },
	serializationKey: 'email:inboxes',
})

/**
 * Id-keyed atom factory. The same `threadId` must return the same atom
 * identity so SSR hydration lands on the atom the component subscribes
 * to.
 */
const threadCache = new Map<string, ReturnType<typeof makeThreadAtom>>()
function makeThreadAtom(threadId: string) {
	return BatudaApiAtom.query('email', 'getThread', {
		params: { threadId },
		serializationKey: `email:thread:${threadId}`,
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
export const updateThreadStatusAtom = BatudaApiAtom.mutation(
	'email',
	'updateThreadStatus',
)
export const markThreadReadAtom = BatudaApiAtom.mutation(
	'email',
	'markThreadRead',
)
export const markThreadUnreadAtom = BatudaApiAtom.mutation(
	'email',
	'markThreadUnread',
)

export const createInboxAtom = BatudaApiAtom.mutation('email', 'createInbox')
export const updateInboxAtom = BatudaApiAtom.mutation('email', 'updateInbox')
export const deleteInboxAtom = BatudaApiAtom.mutation('email', 'deleteInbox')
export const testInboxAtom = BatudaApiAtom.mutation('email', 'testInbox')
export const setPrimaryInboxAtom = BatudaApiAtom.mutation(
	'email',
	'setPrimaryInbox',
)

export const inboxStatusAtom = BatudaApiAtom.query('email', 'inboxStatus', {})
export const providerPresetsAtom = BatudaApiAtom.query(
	'email',
	'listProviderPresets',
	{},
)

// ── Drafts ──
export const createDraftAtom = BatudaApiAtom.mutation('email', 'createDraft')
export const updateDraftAtom = BatudaApiAtom.mutation('email', 'updateDraft')
export const deleteDraftAtom = BatudaApiAtom.mutation('email', 'deleteDraft')
export const sendDraftAtom = BatudaApiAtom.mutation('email', 'sendDraft')
// Which addresses in a draft a send would be refused over, so the compose
// screen can warn while the message is being written rather than on send.
export const checkSuppressedAtom = BatudaApiAtom.mutation(
	'email',
	'checkSuppressed',
)

// ── Footers ──
export const createFooterAtom = BatudaApiAtom.mutation('email', 'createFooter')
export const updateFooterAtom = BatudaApiAtom.mutation('email', 'updateFooter')
export const deleteFooterAtom = BatudaApiAtom.mutation('email', 'deleteFooter')

const footerCache = new Map<string, ReturnType<typeof makeFooterAtom>>()
function makeFooterAtom(inboxId: string) {
	return BatudaApiAtom.query('email', 'listFooters', {
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
