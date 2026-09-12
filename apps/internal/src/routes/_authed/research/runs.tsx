import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'

import { RUN_LIST_FIRST_PAGE, researchRunsAtom } from '#/atoms/research-atoms'
import { ResearchRuns } from '#/components/research/run-list'
import { dehydrateAtom, handOverFromServer } from '#/lib/atom-hydration'
import type { BatudaApiServerClient } from '#/lib/batuda-api-server'
import { listPageQuery } from '#/lib/list-page'
import { researchDlgSchema } from '#/lib/research-dlg'
import { validateSearchWith } from '#/lib/search-schema'

/**
 * The run list, so the monitor screen paints on first render, the same way
 * the inbox does.
 */
function loadRunsOnServer(client: BatudaApiServerClient) {
	return Effect.gen(function* () {
		// Matches `researchRunsAtom` exactly, so the browser reuses this answer.
		return yield* client.research.list({
			query: listPageQuery(RUN_LIST_FIRST_PAGE),
		})
	})
}

export const Route = createFileRoute('/_authed/research/runs')({
	validateSearch: validateSearchWith({ dlg: researchDlgSchema }),
	loader: () =>
		handOverFromServer({
			label: 'ResearchRunsLoader',
			empty: { dehydrated: [] },
			fetch: loadRunsOnServer,
			handOver: runs => ({
				dehydrated: [
					dehydrateAtom(
						researchRunsAtom(RUN_LIST_FIRST_PAGE),
						AsyncResult.success(runs),
					),
				],
			}),
		}),
	head: () => ({ meta: [{ title: 'Research runs — Batuda' }] }),
	component: ResearchRuns,
})
