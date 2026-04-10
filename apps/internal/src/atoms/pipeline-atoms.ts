import { ForjaApiAtom } from '#/lib/forja-api-atom'

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
export const companiesListAtom = ForjaApiAtom.query('companies', 'list', {
	query: { limit: 500 },
})

/**
 * All open tasks (not completed). The dashboard buckets these into
 * overdue / today / this-week, and the Tasks page renders the same set
 * grouped by due date.
 *
 * `completed: 'false'` is a string on purpose — the server parses it
 * from the URL via `Schema.optional(Schema.String)` (see
 * `packages/controllers/src/routes/tasks.ts`). Passing a boolean would
 * fail the schema.
 */
export const openTasksAtom = ForjaApiAtom.query('tasks', 'list', {
	query: { completed: 'false' },
})
