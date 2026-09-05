import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'

import {
	pendingPaidActionsAtom,
	RESEARCH_MONTHLY_SPEND_QUERY,
	researchListQuery,
	researchMonthlySpendAtom,
} from '#/atoms/research-atoms'
import { PAID_ACTION_LIMIT } from '#/components/research/inbox/paid-action-queue'
import {
	INBOX_ATTENTION_RUNS_PARAMS,
	INBOX_FIRST_PAGE,
	INBOX_RUN_COUNT_PARAMS,
	inboxAttentionRunsAtom,
	inboxPendingProposalsAtom,
	inboxRunCountAtom,
	ResearchInbox,
	researchDlgSchema,
} from '#/components/research/inbox/research-inbox'
import { type DehydratedAtomValue, dehydrateAtom } from '#/lib/atom-hydration'
import { listPageQuery } from '#/lib/list-page'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'

/**
 * Server-only load: forwards the Better-Auth cookie and pre-fetches everything
 * the inbox shows above the fold — the pending proposals, the paid-lookup
 * queue, the runs needing attention, the run count and this month's spend — so
 * the whole screen paints on first render.
 */
async function loadInboxOnServer() {
	const [{ Effect, Result }, { makeBatudaApiServer }, cookie] =
		await Promise.all([
			import('effect'),
			import('#/lib/batuda-api-server'),
			getServerCookieHeader(),
		])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		// Each request has to match its atom exactly, counting included, or the
		// browser refetches on arrival and the queue's tile reads the page size
		// instead of how many are really waiting.
		const results = yield* Effect.all(
			{
				proposals: client.research.listPendingProposals({
					query: listPageQuery(INBOX_FIRST_PAGE),
				}),
				// The four below all render above the proposal queue, so fetching
				// them here keeps them from landing late and shoving it down.
				paidActions: client.research.listPendingPaidActions({
					query: { limit: PAID_ACTION_LIMIT },
				}),
				attentionRuns: client.research.list({
					query: researchListQuery(INBOX_ATTENTION_RUNS_PARAMS),
				}),
				runCount: client.research.list({
					query: researchListQuery(INBOX_RUN_COUNT_PARAMS),
				}),
				spend: client.research.spend({ query: RESEARCH_MONTHLY_SPEND_QUERY }),
			},
			// Each answer stands on its own: one tile failing must not cost the
			// page the queue that did arrive. A missing one is fetched by the
			// browser instead.
			{ concurrency: 'unbounded', mode: 'result' },
		)
		const warnSkipped = (name: string, failure: unknown) =>
			console.warn(`[ResearchInboxLoader] ${name} skipped:`, failure)
		if (Result.isFailure(results.proposals)) {
			warnSkipped('proposals', results.proposals.failure)
		}
		if (Result.isFailure(results.paidActions)) {
			warnSkipped('paidActions', results.paidActions.failure)
		}
		if (Result.isFailure(results.attentionRuns)) {
			warnSkipped('attentionRuns', results.attentionRuns.failure)
		}
		if (Result.isFailure(results.runCount)) {
			warnSkipped('runCount', results.runCount.failure)
		}
		if (Result.isFailure(results.spend)) {
			warnSkipped('spend', results.spend.failure)
		}
		return {
			proposals: Result.getOrUndefined(results.proposals),
			paidActions: Result.getOrUndefined(results.paidActions),
			attentionRuns: Result.getOrUndefined(results.attentionRuns),
			runCount: Result.getOrUndefined(results.runCount),
			spend: Result.getOrUndefined(results.spend),
		}
	})
	return await Effect.runPromise(program)
}

export const Route = createFileRoute('/research/')({
	validateSearch: validateSearchWith({ dlg: researchDlgSchema }),
	loader: async () => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		let data: Awaited<ReturnType<typeof loadInboxOnServer>>
		try {
			data = await loadInboxOnServer()
		} catch (error) {
			console.warn(
				'[ResearchInboxLoader] falling back to empty hydration:',
				error,
			)
			return { dehydrated: [] as const }
		}
		// Outside the catch on purpose: the handover only fails through a
		// programming mistake (an atom with no serialization key), which has to
		// break the page rather than quietly turn into a refetch.
		const dehydrated: Array<DehydratedAtomValue> = []
		if (data.proposals) {
			dehydrated.push(
				dehydrateAtom(
					inboxPendingProposalsAtom(),
					AsyncResult.success(data.proposals),
				),
			)
		}
		if (data.paidActions) {
			dehydrated.push(
				dehydrateAtom(
					pendingPaidActionsAtom(PAID_ACTION_LIMIT),
					AsyncResult.success(data.paidActions),
				),
			)
		}
		if (data.attentionRuns) {
			dehydrated.push(
				dehydrateAtom(
					inboxAttentionRunsAtom(),
					AsyncResult.success(data.attentionRuns),
				),
			)
		}
		if (data.runCount) {
			dehydrated.push(
				dehydrateAtom(inboxRunCountAtom(), AsyncResult.success(data.runCount)),
			)
		}
		if (data.spend) {
			dehydrated.push(
				dehydrateAtom(
					researchMonthlySpendAtom,
					AsyncResult.success(data.spend),
				),
			)
		}
		return { dehydrated }
	},
	head: () => ({ meta: [{ title: 'Research — Batuda' }] }),
	component: ResearchInbox,
})
