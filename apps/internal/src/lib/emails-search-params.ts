import { Schema } from 'effect'

import { STALE_DAYS_BOUNDS } from '@batuda/controllers'
import {
	ThreadSort,
	type ThreadStatus,
	ThreadStatus as ThreadStatusSchema,
	ThreadWaitingOn,
} from '@batuda/domain'

import { EMAILS_PAGE_SIZE, type EmailsSearch } from '#/atoms/emails-atoms'
import { validateSearchWith, valueListOf } from '#/lib/search-schema'

/**
 * The `/emails` address: the filters, plus which page of the result is showing.
 *
 * The filters travel under the server's own names, so what the reader picks,
 * what the link carries and what the request asks for are one vocabulary. The
 * page is the screen's alone — the server is told an offset instead.
 */
export type EmailsPageSearch = EmailsSearch & { readonly page?: number }

/** A change to make to the address: the fields named, cleared where undefined. */
export type EmailsSearchPatch = Partial<{
	[K in keyof EmailsPageSearch]: EmailsPageSearch[K] | undefined
}>

/**
 * The order the server reads the list in when nobody says otherwise. Written
 * down here because the screen has to drop it from the address rather than
 * spell it out: a param that changes nothing still makes two addresses of one
 * list, so a link shared from the bar would not match the list it came from.
 */
export const DEFAULT_THREAD_SORT = 'recent_activity' as const

/**
 * How long counts as gone quiet, as the dropdown offers it. A fortnight is the
 * usual answer, so the choices sit either side of it rather than at round
 * numbers for their own sake.
 *
 * Any whole number of days the server accepts still works from a hand-written
 * link — the control shows one it does not offer as an option of its own, so it
 * can be read and put down again.
 */
export const QUIET_DAY_CHOICES: ReadonlyArray<number> = [3, 7, 14, 30]

// Held to what the endpoint accepts rather than to any number: `?quietDays=0`
// and `?quietDays=99999` are refused there, and a filter this page writes that
// the server then turns away would empty the list with nothing on screen
// saying why.
const QuietDays = Schema.Union([Schema.Number, Schema.NumberFromString]).pipe(
	Schema.refine(
		(days): days is number =>
			Number.isInteger(days) &&
			days >= STALE_DAYS_BOUNDS.minimum &&
			days <= STALE_DAYS_BOUNDS.maximum,
	),
)

// Only the word that narrows. Both of these ask for a subset — unread mail,
// mail with something attached — and the opposite is what the list already
// shows, so `?unread=false` is a param that does nothing and is refused rather
// than carried.
const OnlyTrue = Schema.Literals(['true'])

const PageNumber = Schema.Union([Schema.Number, Schema.NumberFromString]).pipe(
	Schema.refine((page): page is number => Number.isFinite(page) && page >= 1),
)

/**
 * The field-by-field half of the route's `validateSearch`. Each param is read on
 * its own, so one stale filter in a link never costs the page the rest of it.
 *
 * A param that cannot be read answers as nothing rather than being left out:
 * the router lays this over the raw address, so a name merely missing here
 * comes back from the address and reaches the server after all.
 */
const decodeSearch = validateSearchWith({
	inboxId: Schema.NonEmptyString,
	companyId: Schema.NonEmptyString,
	contactId: Schema.NonEmptyString,
	status: valueListOf(ThreadStatusSchema),
	waitingOn: ThreadWaitingOn,
	unread: OnlyTrue,
	hasAttachments: OnlyTrue,
	quietDays: QuietDays,
	companyOwner: valueListOf(Schema.NonEmptyString),
	sort: ThreadSort,
	query: Schema.NonEmptyString,
	page: PageNumber,
})

// Which slice to fetch is worked out below from `page`, so these three are the
// request's words and never the address's. An address carrying one would
// otherwise ride straight through — the router lays the validated search over
// the raw address, and everything it holds is handed to the endpoint whole — and
// `?offset=250` would fetch rows 251 to 350 while the page still said it was
// showing the first hundred.
const WIRE_ONLY_PARAMS = ['limit', 'offset', 'count'] as const

/**
 * What the address means, once everything unreadable in it has been refused and
 * everything it did not need to say has been dropped.
 */
export function validateEmailsSearch(
	raw: Record<string, unknown>,
): EmailsPageSearch {
	const decoded: Record<string, unknown> = { ...decodeSearch(raw) }
	// Covered by name rather than deleted, for the same reason the decoder
	// covers what it refuses: a key merely missing here comes back off the raw
	// address.
	if (decoded['sort'] === DEFAULT_THREAD_SORT) decoded['sort'] = undefined
	for (const name of WIRE_ONLY_PARAMS) {
		if (name in raw) decoded[name] = undefined
	}
	return decoded as EmailsPageSearch
}

/**
 * The address as the endpoint reads it: the filters unchanged, plus the slice
 * this page is showing.
 *
 * The filters are handed over whole rather than copied one by one. A filter
 * missed in the copying reaches neither the server nor this page's own request,
 * so the list comes back unfiltered under a key that says it was filtered — and
 * the two halves of the screen, server-rendered and browser-fetched, disagree
 * about what is on it.
 */
export function toWireSearch(search: EmailsPageSearch): EmailsSearch {
	const { page, ...filters } = search
	const wire: Record<string, unknown> = {
		...withoutBlanks(filters),
		limit: EMAILS_PAGE_SIZE,
		// This screen numbers its pages and prints "601–700 of 3400", so it needs
		// the running count on every page, not only the first.
		count: 'exact',
	}
	const offset = ((page ?? 1) - 1) * EMAILS_PAGE_SIZE
	if (offset > 0) wire['offset'] = offset
	return wire as EmailsSearch
}

/**
 * The next address, given a change to part of it.
 *
 * Written once over whatever the search holds rather than a block per field: a
 * block per field has to be extended for every new filter, and a filter that is
 * missed simply never clears.
 */
export function mergeSearch(
	prev: EmailsPageSearch,
	next: EmailsSearchPatch,
): EmailsPageSearch {
	// Narrowing the list changes what is on page seven, so page seven of the old
	// list would open as an empty page of the new one — which reads as "nothing
	// matches" rather than as "you have moved".
	const startsOver = Object.keys(next).some(key => key !== 'page')
	return settle({ ...prev, ...next }, startsOver)
}

// The filters that hold several values at once, and what each one's values are.
type ListFilter = 'status' | 'companyOwner'
type ListMember<K extends ListFilter> = K extends 'status'
	? ThreadStatus
	: string

/**
 * Tick a value in one of the filters that takes several.
 *
 * Built from the search handed in — the one the router is about to give back —
 * rather than from whatever a render captured: two ticks land inside one
 * navigation window often enough, and building both on the same captured list
 * would let the second quietly undo the first.
 */
export function toggleValue<K extends ListFilter>(
	prev: EmailsPageSearch,
	key: K,
	value: ListMember<K>,
): EmailsPageSearch {
	const chosen: ReadonlyArray<string> = prev[key] ?? []
	// Every copy goes, not just the first: a hand-written `?status=open,open`
	// would otherwise take two presses to put down, and the first would look
	// like it did nothing.
	const next = chosen.includes(value)
		? chosen.filter(other => other !== value)
		: [...chosen, value]
	return settle({ ...prev, [key]: next.length === 0 ? undefined : next }, true)
}

// The two the address holds that do not narrow the list: the order to read it
// in, and which page of it is showing.
const NON_NARROWING_KEYS = new Set(['sort', 'page'])

/**
 * Whether anything is narrowing the list.
 *
 * Asking the object rather than naming the filters is what stops a new filter
 * from narrowing the list with nothing on screen offering to clear it.
 */
export function hasActiveFilters(search: EmailsPageSearch): boolean {
	return Object.entries(search).some(([key, value]) => {
		if (NON_NARROWING_KEYS.has(key)) return false
		if (value === undefined || value === null || value === '') return false
		if (Array.isArray(value)) return value.length > 0
		return true
	})
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Drop everything the address does not need to carry: a filter holding nothing,
 * a blank among a filter's values, a list left empty.
 *
 * Dropping rather than writing `undefined` is the only way to clear a search
 * param under `exactOptionalPropertyTypes`, and it is also what keeps
 * `?status=open` from being written as `?status=open&query=`.
 */
function withoutBlanks(
	search: Record<string, unknown>,
): Record<string, unknown> {
	const kept: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(search)) {
		if (value === undefined || value === null || value === '') continue
		if (Array.isArray(value)) {
			const values = (value as ReadonlyArray<string>).filter(v => v !== '')
			if (values.length === 0) continue
			kept[key] = values
			continue
		}
		kept[key] = value
	}
	return kept
}

/** What actually gets written to the address, once a change has been made. */
function settle(
	merged: Record<string, unknown>,
	startsOver: boolean,
): EmailsPageSearch {
	const kept = withoutBlanks(merged)
	// Page one is what an address with no page already means, so writing it adds
	// a param that changes nothing and makes two links out of one list.
	const page = kept['page']
	if (startsOver || (typeof page === 'number' && page <= 1)) delete kept['page']
	return kept as EmailsPageSearch
}
