import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'

import { RUN_LIST_FIRST_PAGE, researchRunsAtom } from '#/atoms/research-atoms'
import { ResearchRuns } from '#/components/research/run-list'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { listPageQuery } from '#/lib/list-page'
import { researchDlgSchema } from '#/lib/research-dlg'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'

/**
 * Server-only load: forwards the Better-Auth cookie and pre-fetches the run
 * list so the monitor screen paints on first render (matching the inbox
 * loader). Falls back to empty hydration on any failure.
 */
async function loadRunsOnServer() {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		// Matches `researchRunsAtom` exactly, so the browser reuses this answer.
		return yield* client.research.list({
			query: listPageQuery(RUN_LIST_FIRST_PAGE),
		})
	})
	return await Effect.runPromise(program)
}

export const Route = createFileRoute('/_authed/research/runs')({
	validateSearch: validateSearchWith({ dlg: researchDlgSchema }),
	loader: async () => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		let runs: Awaited<ReturnType<typeof loadRunsOnServer>>
		try {
			runs = await loadRunsOnServer()
		} catch (error) {
			console.warn(
				'[ResearchRunsLoader] falling back to empty hydration:',
				error,
			)
			return { dehydrated: [] as const }
		}
		// Outside the catch on purpose: the handover only fails through a
		// programming mistake (an atom with no serialization key), which has to
		// break the page rather than quietly turn into a refetch.
		return {
			dehydrated: [
				dehydrateAtom(
					researchRunsAtom(RUN_LIST_FIRST_PAGE),
					AsyncResult.success(runs),
				),
			] as const,
		}
	},
	head: () => ({ meta: [{ title: 'Research runs — Batuda' }] }),
	component: ResearchRuns,
})
