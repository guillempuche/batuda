import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Dedicated atom registry for the tasks inbox.
 *
 * `companiesListAtom` still lives in `pipeline-atoms.ts` because the
 * dashboard and the tasks page both read it — they MUST share identity so
 * SSR hydration doesn't refetch.
 *
 * Everything here is tasks-inbox-only:
 *   - One query per shelf of the rail, plus the counts behind their labels.
 *   - Id-keyed event feed for the right-pane audit log.
 *   - Module-level mutation setters for the inline/row actions.
 */

/** The shelves the inbox rail sorts work onto. */
export type TaskShelf =
	| 'overdue'
	| 'today'
	| 'thisWeek'
	| 'later'
	| 'noDue'
	| 'snoozed'
	| 'doneRecent'

/**
 * How many tasks one shelf shows before asking, and how many more each
 * "Load more" adds.
 */
export const TASKS_PAGE_SIZE = 50

/**
 * Which day it is where the reader is, as `2026-07-25`.
 *
 * Everything below keys on the day rather than the moment. An atom keyed on
 * the current instant would be a different atom on every render and refetch
 * forever, and the shelves only change at midnight anyway.
 */
export function localDayKey(reference: Date = new Date()): string {
	const month = String(reference.getMonth() + 1).padStart(2, '0')
	const day = String(reference.getDate()).padStart(2, '0')
	return `${reference.getFullYear()}-${month}-${day}`
}

/**
 * The stretch of time a day key stands for, in the reader's own timezone.
 * `weekEnd` is the next seven days from tonight, not the end of the calendar
 * week, so "this week" always covers the same amount of ground.
 *
 * These are computed from a plain local `Date` on purpose: "today" is a
 * different span of hours in every timezone, and the server has no way to
 * know which one the person reading the screen is in.
 */
export function dayBoundaries(dayKey: string): {
	readonly todayStart: string
	readonly todayEnd: string
	readonly weekEnd: string
} {
	const start = new Date(`${dayKey}T00:00:00`)
	const end = new Date(start)
	end.setHours(23, 59, 59, 999)
	const weekEnd = new Date(end.getTime() + 7 * 86400_000)
	return {
		todayStart: start.toISOString(),
		todayEnd: end.toISOString(),
		weekEnd: weekEnd.toISOString(),
	}
}

// The soonest deadline leads every shelf still waiting to be worked. Finished
// work reads by when it was finished, and undated work has no deadline to lead
// with, so it falls back to the latest date the task carries.
const sortForShelf = (shelf: TaskShelf) =>
	shelf === 'doneRecent' ? 'completed' : shelf === 'noDue' ? 'recent' : 'due'

const shelfCache = new Map<string, ReturnType<typeof makeShelfAtom>>()

function makeShelfAtom(shelf: TaskShelf, dayKey: string, limit: number) {
	// Held even while nothing is showing it, so opening a task and coming back
	// puts the same rows straight back on screen instead of refetching them and
	// collapsing the shelf to a single page in between.
	return Atom.keepAlive(
		BatudaApiAtom.query('tasks', 'list', {
			query: {
				shelf,
				...dayBoundaries(dayKey),
				sort: sortForShelf(shelf),
				limit,
			},
			serializationKey: `tasks:shelf:${shelf}:${dayKey}:${limit}`,
		}),
	)
}

/**
 * One page of a single shelf. The server decides which tasks belong on it, so
 * the page reports how many there are in total even while showing far fewer.
 */
export function tasksShelfAtom(
	shelf: TaskShelf,
	dayKey: string,
	limit: number = TASKS_PAGE_SIZE,
) {
	const key = `${shelf}::${dayKey}::${limit}`
	const existing = shelfCache.get(key)
	if (existing !== undefined) return existing
	const atom = makeShelfAtom(shelf, dayKey, limit)
	shelfCache.set(key, atom)
	return atom
}

const countsCache = new Map<string, ReturnType<typeof makeTaskCountsAtom>>()

function makeTaskCountsAtom(dayKey: string) {
	return BatudaApiAtom.query('tasks', 'counts', {
		query: dayBoundaries(dayKey),
		serializationKey: `tasks:counts:${dayKey}`,
	})
}

/**
 * How big every shelf is, in one request — what the rail shows beside each
 * name. Counted over the whole organization, so the numbers stay honest no
 * matter how little of a shelf is on screen.
 */
export function taskCountsAtom(dayKey: string) {
	const existing = countsCache.get(dayKey)
	if (existing !== undefined) return existing
	const atom = makeTaskCountsAtom(dayKey)
	countsCache.set(dayKey, atom)
	return atom
}

export const updateTaskAtom = BatudaApiAtom.mutation('tasks', 'update')
export const reopenTaskAtom = BatudaApiAtom.mutation('tasks', 'reopen')
export const cancelTaskAtom = BatudaApiAtom.mutation('tasks', 'cancel')
export const snoozeTaskAtom = BatudaApiAtom.mutation('tasks', 'snooze')
export const rescheduleTaskAtom = BatudaApiAtom.mutation('tasks', 'reschedule')
export const createTaskAtom = BatudaApiAtom.mutation('tasks', 'create')

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
