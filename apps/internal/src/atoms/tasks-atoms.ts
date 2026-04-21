import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Dedicated atom registry for the tasks inbox (§7 of the calendar plan).
 *
 * `openTasksAtom` + `companiesListAtom` still live in
 * `pipeline-atoms.ts` because the dashboard and the tasks page both read
 * them — they MUST share identity so SSR hydration doesn't refetch.
 *
 * Everything here is tasks-inbox-only:
 *   - Smart-view queries that never fire on the dashboard (snoozed,
 *     done-recently).
 *   - Id-keyed event feed for the right-pane audit log.
 *   - Module-level mutation setters for the inline/row actions.
 */

export const snoozedTasksAtom = BatudaApiAtom.query('tasks', 'list', {
	query: { includeSnoozed: 'true', status: 'open' },
})

/**
 * Completed in the last 7 days. The server filter is `status=done`; the
 * 7-day window is applied client-side by bucket logic so the atom stays
 * a stable cache key (an atom that re-keys on `now()` would refetch on
 * every tick). 7-day cutoff is enforced in the bucket selector.
 */
export const doneTasksAtom = BatudaApiAtom.query('tasks', 'list', {
	query: { status: 'done', limit: 100 },
})

export const updateTaskAtom = BatudaApiAtom.mutation('tasks', 'update')
export const reopenTaskAtom = BatudaApiAtom.mutation('tasks', 'reopen')
export const cancelTaskAtom = BatudaApiAtom.mutation('tasks', 'cancel')
export const snoozeTaskAtom = BatudaApiAtom.mutation('tasks', 'snooze')
export const rescheduleTaskAtom = BatudaApiAtom.mutation('tasks', 'reschedule')
export const createTaskAtom = BatudaApiAtom.mutation('tasks', 'create')
export const bulkCompleteTasksAtom = BatudaApiAtom.mutation(
	'tasks',
	'bulkComplete',
)

const taskEventsCache = new Map<string, ReturnType<typeof makeTaskEventsAtom>>()
function makeTaskEventsAtom(taskId: string) {
	return BatudaApiAtom.query('tasks', 'events', { params: { id: taskId } })
}
export function taskEventsAtomFor(taskId: string) {
	const existing = taskEventsCache.get(taskId)
	if (existing !== undefined) return existing
	const atom = makeTaskEventsAtom(taskId)
	taskEventsCache.set(taskId, atom)
	return atom
}

const taskDetailCache = new Map<string, ReturnType<typeof makeTaskDetailAtom>>()
function makeTaskDetailAtom(taskId: string) {
	return BatudaApiAtom.query('tasks', 'get', { params: { id: taskId } })
}
export function taskDetailAtomFor(taskId: string) {
	const existing = taskDetailCache.get(taskId)
	if (existing !== undefined) return existing
	const atom = makeTaskDetailAtom(taskId)
	taskDetailCache.set(taskId, atom)
	return atom
}
