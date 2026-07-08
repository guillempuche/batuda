import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'

import {
	INBOX_PROPOSAL_LIMIT,
	inboxPendingProposalsAtom,
	ResearchInbox,
} from '#/components/research/inbox/research-inbox'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { getServerCookieHeader } from '#/lib/server-cookie'

/**
 * Server-only load: forwards the Better-Auth cookie and pre-fetches the
 * cross-run pending proposals so the inbox paints its queue on first render.
 * The rollup counters (runs, spend) fetch client-side after hydration.
 */
async function loadPendingProposalsOnServer() {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.research.listPendingProposals({
			query: { limit: INBOX_PROPOSAL_LIMIT },
		})
	})
	return await Effect.runPromise(program)
}

export const Route = createFileRoute('/research/')({
	loader: async () => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const proposals = await loadPendingProposalsOnServer()
			return {
				dehydrated: [
					dehydrateAtom(
						inboxPendingProposalsAtom(),
						AsyncResult.success(proposals),
					),
				] as const,
			}
		} catch (error) {
			console.warn(
				'[ResearchInboxLoader] falling back to empty hydration:',
				error,
			)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Research — Batuda' }] }),
	component: ResearchInbox,
})
