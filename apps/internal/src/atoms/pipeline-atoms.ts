import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Shared atom instances for the Pipeline and Tasks pages.
 *
 * Each carries a serialization key, so a route loader can fetch its value on
 * the server and hand it to the browser, where the first render already has
 * it. The Tasks page reads the same `openTasksAtom` as the dashboard, so
 * moving between the two reuses the value instead of asking again.
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
export const pipelineAtom = BatudaApiAtom.query('pipeline', 'get', {
	// Without a key the atom cannot be handed from the server to the browser at
	// all: the handover throws instead of pre-filling the page.
	serializationKey: 'pipeline:get',
})

/**
 * How many rows of each attention list the dashboard shows. The lists are meant
 * to be worked from the top, not read end to end — the server sorts them by
 * urgency and reports how many there are in total, so a handful plus a real
 * count says more than a wall of rows.
 */
export const ATTENTION_PREVIEW = 5

/**
 * Server-computed next steps: the companies needing chasing, split into a
 * missed follow-up, gone quiet, and hot with nothing booked, plus research
 * waiting on a decision. Feeds the dashboard's "needs attention".
 *
 * Asking for only the preview keeps the whole list off the wire — the totals
 * come back regardless, so the heading stays truthful either way.
 */
export const nextStepsAtom = BatudaApiAtom.query('pipeline', 'nextSteps', {
	query: { limit: ATTENTION_PREVIEW },
	serializationKey: `pipeline:next-steps:${ATTENTION_PREVIEW}`,
})
