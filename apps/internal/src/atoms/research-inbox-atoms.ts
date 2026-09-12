import { ATTENTION_RESEARCH_STATUSES } from '@batuda/domain'

import { firstPage, type ListPage, listPageQuery } from '#/lib/list-page'
import {
	type PendingProposalsParams,
	pendingProposalsAtom,
	researchListAtom,
} from './research-atoms'

/* What the research inbox asks for, in one place for the route loader and the
 * screen. Kept apart from the inbox's own file so the loader, which the router
 * keeps in the main bundle, does not pull the whole screen in with it. */

/** How many waiting proposals the queue reads at a time. */
export const INBOX_PROPOSAL_LIMIT = 100

/** The slice both the loader and the screen ask for first. */
export const INBOX_FIRST_PAGE = firstPage(INBOX_PROPOSAL_LIMIT, 'exact')

/** The filters the inbox can narrow its queue by; none means every proposal. */
export type InboxProposalFilters = Pick<
	PendingProposalsParams,
	'minConfidence' | 'machineCheckable'
>

/**
 * The single atom the inbox reads (and the loader hydrates) for its queue.
 * Built here for both so the browser finds what the server fetched: the two
 * only agree while they ask the same question, filters included.
 */
export function inboxPendingProposalsAtom(
	page: ListPage = INBOX_FIRST_PAGE,
	filters: InboxProposalFilters = {},
) {
	// Counted on purpose: the inbox states how many are waiting and how many it
	// could not fit on screen, and neither is knowable from the rows alone.
	return pendingProposalsAtom({ ...listPageQuery(page), ...filters })
}

/** How many paid lookups awaiting approval the queue shows at once. */
export const PAID_ACTION_LIMIT = 50

// Asked for by name rather than sifted out of the newest runs here: sifting
// locally can only ever find the ones that happened to be fetched, so the tile
// counted a slice of the truth and called it the total.
const ATTENTION_STATUS_FILTER = ATTENTION_RESEARCH_STATUSES.join(',')

/** What the attention feed asks for: the runs still waiting on a reader. */
export const INBOX_ATTENTION_RUNS_PARAMS = {
	status: ATTENTION_STATUS_FILTER,
	limit: INBOX_PROPOSAL_LIMIT,
	count: 'exact',
} as const

/** What the "runs" tile asks for: one row, but the exact total alongside it. */
export const INBOX_RUN_COUNT_PARAMS = { limit: 1, count: 'exact' } as const

/**
 * The single atom for the attention feed, so a value fetched ahead of the page
 * is the one the screen reads.
 */
export function inboxAttentionRunsAtom() {
	return researchListAtom(INBOX_ATTENTION_RUNS_PARAMS)
}

/** The single atom behind the "runs" tile, shared for the same reason. */
export function inboxRunCountAtom() {
	return researchListAtom(INBOX_RUN_COUNT_PARAMS)
}
