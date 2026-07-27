import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Shared atom instances for Pipeline + Tasks pages.
 *
 * These are module-level constants so that the Route loader (SSR) and
 * the React component (client) reference the *same* atom identity. The
 * loader produces `[atom, AsyncResult.success(data)]` pairs; the root
 * `<RegistryProvider>` passes them as `initialValues` which seeds the
 * registry before first render, so `useAtomValue` returns `Success`
 * on first paint instead of `Initial`.
 *
 * The plan calls out that the Tasks page reuses `openTasksAtom` —
 * navigating Dashboard → Tasks reuses the cached atom value without a
 * refetch.
 */

/**
 * All companies, up to 500 (single-request limit works for our scale;
 * promote to paginated/infinite list when the company count climbs).
 * The dashboard aggregates this list client-side for every metric
 * (status counts, overdue next-action, stale-pipeline, top priorities).
 */
export const companiesListAtom = BatudaApiAtom.query('companies', 'list', {
	// Counted on purpose: the dashboard prints how many companies there are,
	// and a list that was never counted has nothing truthful to print.
	query: { limit: 500, count: 'exact' },
	serializationKey: 'companies:list:500:exact',
})

/**
 * All open tasks (not completed). The dashboard buckets these into
 * overdue / today / this-week.
 *
 * `completed: 'false'` is a string on purpose — the server parses it
 * from the URL via `Schema.optional(Schema.String)` (see
 * `packages/controllers/src/routes/tasks.ts`). Passing a boolean would
 * fail the schema.
 *
 * The limit is spelled out because leaving it off means 50, not "all", and the
 * dashboard has no "load more" — anything past the cut vanishes from the date
 * groups, and since the furthest-out dates come back first, the most overdue
 * are the first to go (promote to a paginated fetch as the count nears 500).
 */
export const openTasksAtom = BatudaApiAtom.query('tasks', 'list', {
	// Counted on purpose: the "Open tasks" counter reports how many exist, not
	// how many this request happened to bring back.
	query: { completed: 'false', limit: 500, count: 'exact' },
	serializationKey: 'tasks:open:500:exact',
})

/**
 * Server-computed pipeline snapshot — the status histogram plus the two
 * attention counters (overdue tasks, companies without a next action). Replaces
 * the dashboard's client-side `countByStatus` and drives the board column totals.
 */
export const pipelineAtom = BatudaApiAtom.query('pipeline', 'get', {})

/**
 * Server-computed next steps: the open-task queue (ordered by due date) and the
 * companies past their next-action date. Feeds the dashboard's "needs attention".
 */
export const nextStepsAtom = BatudaApiAtom.query('pipeline', 'nextSteps', {
	query: {},
})
