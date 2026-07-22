import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'

import {
	ResearchRuns,
	RUN_LIST_LIMIT,
	researchRunsAtom,
	researchRunsDlgSchema,
} from '#/components/research/run-list'
import { dehydrateAtom } from '#/lib/atom-hydration'
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
		return yield* client.research.list({ query: { limit: RUN_LIST_LIMIT } })
	})
	return await Effect.runPromise(program)
}

export const Route = createFileRoute('/research/runs')({
	validateSearch: validateSearchWith({ dlg: researchRunsDlgSchema }),
	loader: async () => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const runs = await loadRunsOnServer()
			return {
				dehydrated: [
					dehydrateAtom(researchRunsAtom(), AsyncResult.success(runs)),
				] as const,
			}
		} catch (error) {
			console.warn(
				'[ResearchRunsLoader] falling back to empty hydration:',
				error,
			)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Research runs — Batuda' }] }),
	component: ResearchRuns,
})
