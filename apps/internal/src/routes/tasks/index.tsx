import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { DateTime, Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Clock, History, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import type { Company } from '@batuda/domain'
import { PriButton, PriDialog, PriInput } from '@batuda/ui/pri'

import { companiesListAtom } from '#/atoms/pipeline-atoms'
import {
	cancelTaskAtom,
	createTaskAtom,
	localDayKey,
	reopenTaskAtom,
	rescheduleTaskAtom,
	snoozeTaskAtom,
	TASKS_PAGE_SIZE,
	type TaskShelf,
	taskCountsAtom,
	taskEventsAtomFor,
	tasksShelfAtom,
	updateTaskAtom,
} from '#/atoms/tasks-atoms'
import { SubjectDocuments } from '#/components/documents/subject-documents'
import { EmptyState } from '#/components/shared/empty-state'
import { ErrorState } from '#/components/shared/error-state'
import { InfiniteListFooter } from '#/components/shared/infinite-list-footer'
import { KpiCounter } from '#/components/shared/kpi-counter'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { SrOnly } from '#/components/shared/sr-only'
import {
	TaskItem,
	type TaskItemData,
	type TaskPriorityLabel,
	type TaskSourceLabel,
} from '#/components/shared/task-item'
import { useQuickCapture } from '#/context/quick-capture-context'
import { useInfiniteList } from '#/hooks/use-infinite-list'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import type { PaginatedList } from '#/lib/paginated-list'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { useDlg } from '#/lib/use-dlg'
import {
	agedPaperSurface,
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Task inbox — a rail of shelves (today / overdue / this week / later / no
 * due / snoozed / done 7d), inline edit on title + due, and a right-pane
 * detail editor backed by `task_events`. The server decides which shelf a
 * task sits on and how big each shelf is, so a rail count and the rows
 * underneath it always describe the same set. Mutations go through
 * `@batuda/controllers` typed atoms so optimistic concurrency (`If-Match`)
 * is cheap to enable later.
 */
type TaskRow = {
	readonly id: string
	readonly companyId: string | null
	readonly type: string
	readonly title: string
	readonly status: string
	readonly priority: TaskPriorityLabel
	readonly source: TaskSourceLabel
	readonly dueAt: string | null
	readonly snoozedUntil: string | null
	readonly completedAt: string | null
	readonly updatedAt: string | null
}

type CompanyLookup = {
	readonly id: string
	readonly slug: string
	readonly name: string
}

// The rail, in the order it reads top to bottom, with the copy each shelf
// shows when it is empty. Every string is a `msg` descriptor at module scope
// so `lingui extract` can find it: passing `t` into a helper shadows the
// macro, and the string then ships in English whatever the reader's language.
const SHELVES: ReadonlyArray<{
	readonly shelf: TaskShelf
	readonly testId: string
	readonly label: MessageDescriptor
	readonly emptyTitle: MessageDescriptor
	readonly emptyDescription: MessageDescriptor
}> = [
	{
		shelf: 'today',
		testId: 'tasks-view-today',
		label: msg`Today`,
		emptyTitle: msg`All under control`,
		emptyDescription: msg`No pending tasks today. Time to prospect or take a walk.`,
	},
	{
		shelf: 'overdue',
		testId: 'tasks-view-overdue',
		label: msg`Overdue`,
		emptyTitle: msg`Nothing overdue`,
		emptyDescription: msg`The ledger is clean.`,
	},
	{
		shelf: 'thisWeek',
		testId: 'tasks-view-this-week',
		label: msg`This week`,
		emptyTitle: msg`No tasks this week`,
		emptyDescription: msg`The week is clear — good time to plan.`,
	},
	{
		shelf: 'later',
		testId: 'tasks-view-later',
		label: msg`Later`,
		emptyTitle: msg`Nothing later in the queue`,
		emptyDescription: msg`No tasks scheduled beyond this week.`,
	},
	{
		shelf: 'noDue',
		testId: 'tasks-view-no-due',
		label: msg`No due date`,
		emptyTitle: msg`Every task has a date`,
		emptyDescription: msg`Every open task has a due date assigned.`,
	},
	{
		shelf: 'snoozed',
		testId: 'tasks-view-snoozed',
		label: msg`Snoozed`,
		emptyTitle: msg`Nothing snoozed`,
		emptyDescription: msg`No tasks are sleeping.`,
	},
	{
		shelf: 'doneRecent',
		testId: 'tasks-view-done',
		label: msg`Done 7d`,
		emptyTitle: msg`Nothing completed recently`,
		emptyDescription: msg`No tasks completed in the last 7 days.`,
	},
]

const shelfCopy = (shelf: TaskShelf) =>
	SHELVES.find(entry => entry.shelf === shelf) ?? SHELVES[0]!

// What the rail shows before the real sizes arrive. Zeroes rather than blanks
// keep the buttons from resizing under the pointer as the counts land.
const EMPTY_COUNTS: Record<TaskShelf, number> = {
	overdue: 0,
	today: 0,
	thisWeek: 0,
	later: 0,
	noDue: 0,
	snoozed: 0,
	doneRecent: 0,
}

// Everything still waiting, wherever it sits on the rail.
const OPEN_SHELVES: ReadonlyArray<TaskShelf> = [
	'overdue',
	'today',
	'thisWeek',
	'later',
	'noDue',
]

const completeTaskAtom = BatudaApiAtom.mutation('tasks', 'complete')

/**
 * Only the companies are fetched ahead of time. Which tasks are due "today"
 * depends on where the reader is in the world, and the server has no way to
 * know that, so the shelves are left for the browser to ask for.
 */
async function loadCompaniesOnServer(): Promise<PaginatedList<Company>> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.companies.list({ query: { limit: 500 } })
	})
	return Effect.runPromise(program)
}

// The open task and the recent-changes list live in `?dlg=`, so a task can be
// linked to and Back steps out of it.
const tasksDlgSchema = Schema.Union([
	dlgWithId('task'),
	dlgNoId('recent-changes'),
])

// How long the address waits behind a keyboard walk before it names the task
// the pane is on.
const ADDRESS_CATCH_UP_MS = 200

export const Route = createFileRoute('/tasks/')({
	validateSearch: validateSearchWith({ dlg: tasksDlgSchema }),
	loader: async () => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const companies = await loadCompaniesOnServer()
			return {
				dehydrated: [
					dehydrateAtom(companiesListAtom, AsyncResult.success(companies)),
				] as const,
			}
		} catch (error) {
			console.warn('[TasksLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Tasks — Batuda' }] }),
	component: TasksPage,
})

function TasksPage() {
	const { t } = useLingui()
	const [selectedShelf, setSelectedShelf] = useState<TaskShelf>('today')
	// Which day it is where the reader sits. Held in state rather than read on
	// every render, which would hand every render a different atom to fetch —
	// but a tab left open overnight would then keep filing work under
	// yesterday, so it is re-read whenever the window comes back to the front.
	const [dayKey, setDayKey] = useState(() => localDayKey())

	// The shelf grows as the reader reaches the end of it. Moving to another
	// shelf starts again at its first page, because the rows in hand belong to
	// work the reader is no longer looking at.
	const shelfList = useInfiniteList({
		resetKey: `${selectedShelf}::${dayKey}`,
		pageSize: TASKS_PAGE_SIZE,
		atomFor: limit => tasksShelfAtom(selectedShelf, dayKey, limit),
	})
	const countsAtom = useMemo(() => taskCountsAtom(dayKey), [dayKey])
	const countsResult = useAtomValue(countsAtom)
	const companiesResult = useAtomValue(companiesListAtom)
	const refreshTasks = shelfList.refresh
	const refreshCounts = useAtomRefresh(countsAtom)
	const refreshCompanies = useAtomRefresh(companiesListAtom)
	const completeTask = useAtomSet(completeTaskAtom, { mode: 'promiseExit' })
	const reopenTask = useAtomSet(reopenTaskAtom, { mode: 'promiseExit' })
	const cancelTask = useAtomSet(cancelTaskAtom, { mode: 'promiseExit' })
	const snoozeTask = useAtomSet(snoozeTaskAtom, { mode: 'promiseExit' })
	const rescheduleTask = useAtomSet(rescheduleTaskAtom, {
		mode: 'promiseExit',
	})
	const updateTask = useAtomSet(updateTaskAtom, { mode: 'promiseExit' })
	const createTask = useAtomSet(createTaskAtom, { mode: 'promiseExit' })
	const { open: openQuickCapture } = useQuickCapture()

	const { dlg, open: openDlg, close: closeDlg } = useDlg(tasksDlgSchema)
	const undoOpen = dlg?.kind === 'recent-changes'

	// While j/k are moving the open pane down the list, the task under the cursor
	// is held here and the address catches up once the keys stop. Holding a key
	// repeats it dozens of times a second, and browsers cap how often a page may
	// rewrite its address — so a long press would otherwise be refused outright.
	const [movingToId, setMovingToId] = useState<string | null>(null)
	const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const selectedTaskId = movingToId ?? (dlg?.kind === 'task' ? dlg.id : null)

	// Opening a task is a step the reader can take back. Moving the pane between
	// rows is not — one entry per keystroke would turn Back into an undo of every
	// key pressed, so those moves overwrite instead.
	const openTask = useCallback(
		(id: string) => openDlg({ kind: 'task', id }),
		[openDlg],
	)
	const moveTaskSelection = useCallback(
		(id: string) => {
			setMovingToId(id)
			if (moveTimer.current !== null) clearTimeout(moveTimer.current)
			moveTimer.current = setTimeout(() => {
				moveTimer.current = null
				openDlg({ kind: 'task', id }, { replace: true })
			}, ADDRESS_CATCH_UP_MS)
		},
		[openDlg],
	)
	// Closing the pane also drops any move still waiting to be written, so a key
	// pressed a moment earlier can't bring the pane back after it has gone.
	const closeTaskPane = useCallback(() => {
		if (moveTimer.current !== null) {
			clearTimeout(moveTimer.current)
			moveTimer.current = null
		}
		setMovingToId(null)
		closeDlg()
	}, [closeDlg])
	// Once the address names the same task, drop the held one so the address is
	// the single answer again.
	useEffect(() => {
		if (movingToId !== null && dlg?.kind === 'task' && dlg.id === movingToId) {
			setMovingToId(null)
		}
	}, [dlg, movingToId])
	useEffect(
		() => () => {
			if (moveTimer.current !== null) clearTimeout(moveTimer.current)
		},
		[],
	)
	const quickAddRef = useRef<HTMLInputElement | null>(null)
	// The last version of the task the pane is showing.
	const lastOpenTask = useRef<TaskRow | null>(null)

	const visibleTasks = useMemo<ReadonlyArray<TaskRow>>(
		() => narrowTasks(shelfList.items),
		[shelfList.items],
	)
	// How many the shelf holds altogether, which is what the rail promises —
	// the rows in hand stop at whatever has been asked for so far.
	const shelfTotal = shelfList.total

	const counts = AsyncResult.isSuccess(countsResult)
		? countsResult.value
		: EMPTY_COUNTS
	const openCount = OPEN_SHELVES.reduce((sum, shelf) => sum + counts[shelf], 0)

	// Only the arrival of rows is announced here. While they are on their way
	// the spinner says "loading" out loud, and a failure is read out by the
	// error message itself — repeating either would say it twice.
	const shelfAnnouncement =
		!shelfList.isLoadingFirstPage && !shelfList.isError
			? t`${t(shelfCopy(selectedShelf).label)}: showing ${visibleTasks.length} of ${shelfTotal} tasks.`
			: ''

	const companiesLoaded = AsyncResult.isSuccess(companiesResult)
	const companiesById = useMemo<Map<string, CompanyLookup>>(() => {
		if (!AsyncResult.isSuccess(companiesResult)) return new Map()
		const map = new Map<string, CompanyLookup>()
		for (const row of companiesResult.value.items as ReadonlyArray<unknown>) {
			if (!row || typeof row !== 'object') continue
			const r = row as Record<string, unknown>
			if (
				typeof r['id'] === 'string' &&
				typeof r['slug'] === 'string' &&
				typeof r['name'] === 'string'
			) {
				map.set(r['id'], {
					id: r['id'],
					slug: r['slug'],
					name: r['name'],
				})
			}
		}
		return map
	}, [companiesResult])

	// Any edit can move a task between shelves, so the sizes on the rail are
	// refreshed alongside the list itself.
	const refreshAll = useCallback(() => {
		refreshTasks()
		refreshCounts()
		refreshCompanies()
	}, [refreshTasks, refreshCounts, refreshCompanies])

	// Refresh when the window regains focus — catches webhook-driven
	// edits (an agent updated a task in another tab or via MCP).
	useEffect(() => {
		const onFocus = () => {
			setDayKey(localDayKey())
			refreshAll()
		}
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	}, [refreshAll])

	const handleToggle = useCallback(
		async (taskId: string, nextCompleted: boolean) => {
			if (nextCompleted) {
				await completeTask({ params: { id: taskId } } as never)
				// Finishing the task you have open closes it: the detail pane covers
				// the list, and there is nothing left to do with a task you just ticked
				// off. Finished tasks stay readable for a week, so it will not close
				// itself.
				if (taskId === selectedTaskId) closeTaskPane()
			} else {
				await reopenTask({ params: { id: taskId } } as never)
			}
			refreshAll()
		},
		[completeTask, reopenTask, refreshAll, selectedTaskId, closeTaskPane],
	)

	const handleCancel = useCallback(
		async (taskId: string) => {
			await cancelTask({ params: { id: taskId } } as never)
			refreshAll()
		},
		[cancelTask, refreshAll],
	)

	const handleSnooze = useCallback(
		async (taskId: string) => {
			const untilDate = new Date(Date.now() + 86400_000)
			const until = DateTime.fromDateUnsafe(untilDate)
			await snoozeTask({
				params: { id: taskId },
				payload: { until },
			} as never)
			refreshAll()
		},
		[snoozeTask, refreshAll],
	)

	const handleReschedule = useCallback(
		async (taskId: string, next: Date | null) => {
			const dueAt = next ? DateTime.fromDateUnsafe(next) : null
			await rescheduleTask({
				params: { id: taskId },
				payload: { dueAt },
			} as never)
			refreshAll()
		},
		[rescheduleTask, refreshAll],
	)

	const handleEditTitle = useCallback(
		async (taskId: string, nextTitle: string) => {
			await updateTask({
				params: { id: taskId },
				headers: {},
				payload: { title: nextTitle },
			} as never)
			refreshAll()
		},
		[updateTask, refreshAll],
	)

	const handleQuickAdd = useCallback(
		async (raw: string) => {
			const parsed = parseQuickAdd(raw)
			if (parsed === null) return
			const payload: Record<string, unknown> = {
				type: 'other',
				title: parsed.title,
				priority: parsed.priority,
			}
			if (parsed.dueAt !== null) {
				payload['dueAt'] = DateTime.fromDateUnsafe(parsed.dueAt)
			}
			await createTask({ payload } as never)
			refreshAll()
		},
		[createTask, refreshAll],
	)

	const handleLogInteraction = useCallback(
		(companyId: string) => {
			const company = companiesById.get(companyId)
			if (!company) return
			openQuickCapture({
				companyId: company.id,
				companyName: company.name,
				onSubmitted: refreshAll,
			})
		},
		[companiesById, openQuickCapture, refreshAll],
	)

	const toTaskItemData = useCallback(
		(task: TaskRow): TaskItemData => {
			const company =
				task.companyId !== null
					? (companiesById.get(task.companyId) ?? null)
					: null
			// "Personal" means the task belongs to nobody in particular — only
			// true once the companies are in hand. While they are still on their
			// way the name is left blank rather than mislabelling real accounts.
			const companyName =
				company?.name ??
				(task.companyId === null || companiesLoaded ? t`Personal` : '')
			return {
				id: task.id,
				title: task.title,
				dueAt: task.dueAt,
				companyId: task.companyId ?? '',
				companyName,
				priority: task.priority,
				source: task.source,
				...(company?.slug !== undefined ? { companySlug: company.slug } : {}),
			}
		},
		[companiesById, companiesLoaded, t],
	)

	// ── Keyboard shortcuts (j/k, x, s, /, c, g o, g t, e) ──
	const [gPrimed, setGPrimed] = useState(false)
	useEffect(() => {
		function onKey(ev: KeyboardEvent) {
			const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase()
			const editable =
				tag === 'input' ||
				tag === 'textarea' ||
				(ev.target as HTMLElement | null)?.isContentEditable
			if (editable && ev.key !== 'Escape') return

			if (ev.key === '/') {
				ev.preventDefault()
				quickAddRef.current?.focus()
				return
			}
			if (ev.key === 'c') {
				ev.preventDefault()
				quickAddRef.current?.focus()
				return
			}
			if (ev.key === 'g') {
				setGPrimed(true)
				setTimeout(() => setGPrimed(false), 900)
				return
			}
			if (gPrimed && ev.key === 'o') {
				ev.preventDefault()
				setSelectedShelf('overdue')
				setGPrimed(false)
				return
			}
			if (gPrimed && ev.key === 't') {
				ev.preventDefault()
				setSelectedShelf('today')
				setGPrimed(false)
				return
			}
			if (visibleTasks.length === 0) return
			const currentIdx =
				selectedTaskId !== null
					? visibleTasks.findIndex(row => row.id === selectedTaskId)
					: -1
			if (ev.key === 'j') {
				ev.preventDefault()
				const nextIdx = Math.min(visibleTasks.length - 1, currentIdx + 1)
				const next = visibleTasks[nextIdx]
				if (next) moveTaskSelection(next.id)
				return
			}
			if (ev.key === 'k') {
				ev.preventDefault()
				const prevIdx = Math.max(0, currentIdx - 1)
				const prev = visibleTasks[prevIdx]
				if (prev) moveTaskSelection(prev.id)
				return
			}
			if (ev.key === 'x' && selectedTaskId !== null) {
				ev.preventDefault()
				void handleToggle(selectedTaskId, true)
				return
			}
			if (ev.key === 's' && selectedTaskId !== null) {
				ev.preventDefault()
				void handleSnooze(selectedTaskId)
				return
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [
		gPrimed,
		visibleTasks,
		selectedTaskId,
		handleToggle,
		handleSnooze,
		moveTaskSelection,
	])

	// Only the list waits for its rows: blanking the whole page on every shelf
	// switch would make the shelf buttons vanish under the pointer and send the
	// keyboard back to the top of the page.
	const isShelfPending = shelfList.isLoadingFirstPage
	const hasShelfFailed = shelfList.isError

	const countsReady = AsyncResult.isSuccess(countsResult)

	// Acting on a task from its own detail pane — snoozing it, cancelling it,
	// ticking it off — usually moves it to another shelf. Keeping the last
	// version of the open task means the pane stays put and shows the result
	// instead of vanishing mid-interaction.
	const onScreen =
		selectedTaskId !== null
			? (visibleTasks.find(r => r.id === selectedTaskId) ?? null)
			: null
	if (onScreen !== null) lastOpenTask.current = onScreen
	const selectedTask =
		selectedTaskId === null
			? null
			: (onScreen ??
				(lastOpenTask.current?.id === selectedTaskId
					? lastOpenTask.current
					: null))

	return (
		<Page>
			<Intro>
				<IntroText>
					<Title>
						<Trans>Tasks</Trans>
					</Title>
					<Subtitle>
						<Trans>The workshop ledger — tear off one strip at a time.</Trans>
					</Subtitle>
				</IntroText>
				<KpiRow>
					<KpiCounter value={openCount} label={t`Open`} />
					{counts.overdue > 0 && (
						<KpiCounter value={counts.overdue} label={t`Overdue`} />
					)}
				</KpiRow>
			</Intro>

			{/* The list changes without the keyboard moving anywhere, so anyone not
			 * looking at the screen gets no sign of it. This line sits outside the
			 * column that swaps, because a spoken message that disappears along
			 * with the list it describes is often never read out. */}
			<SrOnly role='status' aria-live='polite'>
				{shelfAnnouncement}
			</SrOnly>

			<Layout>
				<Rail
					as='div'
					role='group'
					aria-label={t`Filter tasks by shelf`}
					aria-busy={!countsReady}
					data-testid='tasks-view-rail'
				>
					{SHELVES.map(({ shelf, testId, label }) => (
						<RailButton
							key={shelf}
							$active={selectedShelf === shelf}
							type='button'
							aria-pressed={selectedShelf === shelf}
							onClick={() => setSelectedShelf(shelf)}
							data-testid={testId}
						>
							{t(label)}
							{/* The badge shows 0 until the real counts arrive so the buttons
							 * keep their width, but reading "0" out loud would be wrong —
							 * the number is only spoken once it is true. */}
							<Count aria-hidden>{counts[shelf]}</Count>
							<SrOnly>
								{countsReady ? (
									<Plural value={counts[shelf]} one='# task' other='# tasks' />
								) : (
									t`count loading`
								)}
							</SrOnly>
						</RailButton>
					))}
					<RailDivider aria-hidden />
					<RailButton
						$active={false}
						type='button'
						aria-haspopup='dialog'
						onClick={() => openDlg({ kind: 'recent-changes' })}
						data-testid='tasks-recent-changes-open'
					>
						<History size={12} aria-hidden />
						<Trans>Recent changes</Trans>
					</RailButton>
				</Rail>

				<Column>
					<QuickAddForm
						onSubmit={handleQuickAdd}
						inputRef={quickAddRef}
						placeholder={t`Quick add: "Call Acme tomorrow #high"`}
					/>

					{isShelfPending ? (
						<LoadingSpinner label={t`Loading tasks…`} />
					) : hasShelfFailed ? (
						// A shelf that failed to load must not read as a shelf with
						// nothing on it — "the ledger is clean" would be a lie about
						// work that is still waiting.
						<ErrorState
							data-testid='tasks-error'
							title={t`Could not load these tasks`}
							description={t`The list could not be fetched. Check the connection, then try again.`}
							onRetry={refreshAll}
						/>
					) : visibleTasks.length === 0 ? (
						<EmptyState
							title={t(shelfCopy(selectedShelf).emptyTitle)}
							description={t(shelfCopy(selectedShelf).emptyDescription)}
						/>
					) : (
						<>
							<Stack>
								{visibleTasks.map(task => {
									const companyId = task.companyId
									const logInteractionProps =
										companyId !== null
											? {
													onLogInteraction: () =>
														handleLogInteraction(companyId),
												}
											: {}
									return (
										<TaskItem
											key={task.id}
											task={toTaskItemData(task)}
											completed={task.status === 'done'}
											overdue={
												selectedShelf === 'overdue' ||
												(task.dueAt !== null &&
													Date.parse(task.dueAt) < startOfDay(Date.now()))
											}
											onToggle={next => void handleToggle(task.id, next)}
											onEditTitle={next => handleEditTitle(task.id, next)}
											onEditDue={next => handleReschedule(task.id, next)}
											onOpenDetail={() => openTask(task.id)}
											{...logInteractionProps}
										/>
									)
								})}
							</Stack>
							<InfiniteListFooter
								list={shelfList}
								testId='tasks'
								announce={false}
							/>
						</>
					)}
				</Column>
			</Layout>

			{selectedTask !== null && (
				<DetailPane
					task={selectedTask}
					company={
						selectedTask.companyId !== null
							? (companiesById.get(selectedTask.companyId) ?? null)
							: null
					}
					onClose={closeTaskPane}
					onSnooze={() => void handleSnooze(selectedTask.id)}
					onCancel={() => void handleCancel(selectedTask.id)}
					onToggle={next => void handleToggle(selectedTask.id, next)}
				/>
			)}

			<UndoDialog
				open={undoOpen}
				onOpenChange={next => {
					if (next) openDlg({ kind: 'recent-changes' })
					else closeDlg()
				}}
				tasks={visibleTasks}
			/>
		</Page>
	)
}

// ── Quick add form ─────────────────────────────────────────────────

function QuickAddForm({
	onSubmit,
	inputRef,
	placeholder,
}: {
	onSubmit: (raw: string) => Promise<void>
	inputRef: React.MutableRefObject<HTMLInputElement | null>
	placeholder: string
}) {
	const { t } = useLingui()
	const [value, setValue] = useState('')
	const [pending, setPending] = useState(false)

	const submit = async () => {
		const trimmed = value.trim()
		if (trimmed.length === 0) return
		setPending(true)
		try {
			await onSubmit(trimmed)
			setValue('')
		} finally {
			setPending(false)
		}
	}

	return (
		<QuickAddRow
			data-testid='tasks-quick-add-form'
			onSubmit={e => {
				e.preventDefault()
				void submit()
			}}
		>
			<QuickAddInput
				data-testid='tasks-quick-add-input'
				ref={inputRef}
				value={value}
				onChange={e => setValue(e.target.value)}
				placeholder={placeholder}
				disabled={pending}
				aria-label={t`Quick add task`}
			/>
			<QuickAddButton
				type='submit'
				disabled={pending || value.trim() === ''}
				data-testid='tasks-quick-add-submit'
			>
				<Plus size={14} aria-hidden />
				<Trans>Add</Trans>
			</QuickAddButton>
		</QuickAddRow>
	)
}

// ── Detail pane ────────────────────────────────────────────────────

function DetailPane({
	task,
	company,
	onClose,
	onSnooze,
	onCancel,
	onToggle,
}: {
	task: TaskRow
	company: CompanyLookup | null
	onClose: () => void
	onSnooze: () => void
	onCancel: () => void
	onToggle: (next: boolean) => void
}) {
	const { t } = useLingui()
	const eventsAtom = useMemo(() => taskEventsAtomFor(task.id), [task.id])
	const eventsResult = useAtomValue(eventsAtom)

	const events = useMemo<ReadonlyArray<TaskEventRow>>(
		() =>
			AsyncResult.isSuccess(eventsResult)
				? narrowEvents(eventsResult.value)
				: [],
		[eventsResult],
	)

	return (
		<PriDialog.Root open onOpenChange={open => !open && onClose()}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='task-detail-dialog'>
					<PriDialog.Title>{task.title}</PriDialog.Title>
					<PriDialog.Description>
						{company !== null ? company.name : t`Personal`}
					</PriDialog.Description>

					<DetailMeta>
						<DetailField>
							<DetailLabel>
								<Trans>Status</Trans>
							</DetailLabel>
							<DetailValue>{task.status}</DetailValue>
						</DetailField>
						<DetailField>
							<DetailLabel>
								<Trans>Priority</Trans>
							</DetailLabel>
							<DetailValue>{task.priority}</DetailValue>
						</DetailField>
						<DetailField>
							<DetailLabel>
								<Trans>Source</Trans>
							</DetailLabel>
							<DetailValue>{task.source}</DetailValue>
						</DetailField>
						<DetailField>
							<DetailLabel>
								<Trans>Due</Trans>
							</DetailLabel>
							<DetailValue>
								{task.dueAt !== null
									? new Date(task.dueAt).toLocaleDateString('en')
									: t`no date`}
							</DetailValue>
						</DetailField>
					</DetailMeta>

					<ActionRow>
						<PriButton
							onClick={() => onToggle(task.status !== 'done')}
							data-testid='task-detail-toggle'
						>
							{task.status === 'done' ? t`Reopen` : t`Complete`}
						</PriButton>
						<PriButton
							$variant='text'
							onClick={onSnooze}
							data-testid='task-detail-snooze'
						>
							<Clock size={12} aria-hidden />
							<Trans>Snooze 1d</Trans>
						</PriButton>
						<PriButton
							$variant='text'
							onClick={onCancel}
							data-testid='task-detail-cancel'
						>
							<Trans>Cancel</Trans>
						</PriButton>
					</ActionRow>

					<SubjectDocuments subjectTable='tasks' subjectId={task.id} />

					<EventsHeader>
						<Trans>Audit log</Trans>
					</EventsHeader>
					{events.length === 0 ? (
						<EmptyAudit>
							<Trans>No changes recorded yet.</Trans>
						</EmptyAudit>
					) : (
						<EventsList>
							{events.map(ev => (
								<EventRow key={ev.id}>
									<EventActor>{ev.actorKind}</EventActor>
									<EventSummary>{summariseChange(ev)}</EventSummary>
									<EventAt>
										{new Date(ev.at).toLocaleString('en', {
											dateStyle: 'short',
											timeStyle: 'short',
										})}
									</EventAt>
								</EventRow>
							))}
						</EventsList>
					)}
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

// ── Undo drawer (recent task_events across all open tasks) ─────────

function UndoDialog({
	open,
	onOpenChange,
	tasks,
}: {
	open: boolean
	onOpenChange: (next: boolean) => void
	tasks: ReadonlyArray<TaskRow>
}) {
	const { t } = useLingui()
	// Pull the latest `updated_at` from the tasks already on screen — there is
	// no cross-task event feed; per-task audit lives in the detail pane.
	const recent = useMemo(() => {
		const withUpdate = tasks.filter(
			(r): r is TaskRow & { updatedAt: string } => r.updatedAt !== null,
		)
		return [...withUpdate]
			.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
			.slice(0, 20)
	}, [tasks])

	return (
		<PriDialog.Root open={open} onOpenChange={onOpenChange}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='tasks-recent-changes-dialog'>
					<PriDialog.Title>
						<Trans>Recent changes</Trans>
					</PriDialog.Title>
					<PriDialog.Description>
						<Trans>
							The 20 most recently edited tasks on this shelf. Click one to
							reopen it.
						</Trans>
					</PriDialog.Description>
					{recent.length === 0 ? (
						<EmptyAudit>
							<Trans>Nothing changed yet.</Trans>
						</EmptyAudit>
					) : (
						<EventsList>
							{recent.map(row => (
								<EventRow key={row.id}>
									<EventSummary>{row.title}</EventSummary>
									<EventAt>
										{row.updatedAt !== null
											? new Date(row.updatedAt).toLocaleString('en', {
													dateStyle: 'short',
													timeStyle: 'short',
												})
											: t`unknown`}
									</EventAt>
								</EventRow>
							))}
						</EventsList>
					)}
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

// ── Helpers ────────────────────────────────────────────────────────

type TaskEventRow = {
	readonly id: string
	readonly at: string
	readonly actorKind: string
	readonly change: unknown
}

function startOfDay(ms: number): number {
	const d = new Date(ms)
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}

function narrowTasks(rows: ReadonlyArray<unknown>): ReadonlyArray<TaskRow> {
	const out: Array<TaskRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		const priority = isPriority(r['priority']) ? r['priority'] : 'normal'
		const source = isSource(r['source']) ? r['source'] : 'user'
		out.push({
			id: r['id'],
			companyId: typeof r['companyId'] === 'string' ? r['companyId'] : null,
			type: typeof r['type'] === 'string' ? r['type'] : 'other',
			title: r['title'],
			status: typeof r['status'] === 'string' ? r['status'] : 'open',
			priority,
			source,
			dueAt: readIsoString(r, 'dueAt'),
			snoozedUntil: readIsoString(r, 'snoozedUntil'),
			completedAt: readIsoString(r, 'completedAt'),
			updatedAt: readIsoString(r, 'updatedAt'),
		})
	}
	return out
}

// A date field can reach this page as a date value or as plain text, so both
// shapes are read back as one ISO string.
function readIsoString(
	r: Record<string, unknown>,
	field: string,
): string | null {
	const value = r[field]
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

function isPriority(v: unknown): v is TaskPriorityLabel {
	return v === 'low' || v === 'normal' || v === 'high'
}

function isSource(v: unknown): v is TaskSourceLabel {
	return (
		v === 'user' ||
		v === 'agent' ||
		v === 'webhook' ||
		v === 'email' ||
		v === 'booking'
	)
}

function narrowEvents(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<TaskEventRow> {
	const out: Array<TaskEventRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		const at = readIsoString(r, 'at')
		if (at === null) continue
		const actorKind =
			typeof r['actorKind'] === 'string' ? r['actorKind'] : 'user'
		out.push({
			id: r['id'],
			at,
			actorKind,
			change: r['change'],
		})
	}
	return out
}

function summariseChange(ev: TaskEventRow): string {
	if (!ev.change || typeof ev.change !== 'object') return '—'
	const ch = ev.change as Record<string, unknown>
	const kind = typeof ch['kind'] === 'string' ? ch['kind'] : null
	if (kind === 'created') return 'created'
	const keys = Object.keys(ch).filter(k => k !== 'kind')
	if (keys.length === 0) return 'updated'
	return keys.join(', ')
}

/**
 * Quick-add parser: turns "Call Acme tomorrow #high" into
 * `{ title: "Call Acme", dueAt: tomorrow, priority: 'high' }`.
 *
 * Recognised tokens (case-insensitive, must appear as whole words):
 *   - `#high | #normal | #low` → priority
 *   - `today | tomorrow | mon | tue | wed | thu | fri | sat | sun` →
 *     dueAt (next occurrence at 9am local time)
 *   - `in Nd | in Nw` → relative date
 *
 * Everything else is the title.
 */
export function parseQuickAdd(raw: string): {
	readonly title: string
	readonly dueAt: Date | null
	readonly priority: TaskPriorityLabel
} | null {
	const trimmed = raw.trim()
	if (trimmed.length === 0) return null

	let priority: TaskPriorityLabel = 'normal'
	let dueAt: Date | null = null
	const kept: string[] = []

	const tokens = trimmed.split(/\s+/)
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i]
		if (tok === undefined) continue
		const lower = tok.toLowerCase()
		if (lower === '#high' || lower === '#low' || lower === '#normal') {
			priority = lower.slice(1) as TaskPriorityLabel
			continue
		}
		if (lower === 'today') {
			dueAt = atNineAm(0)
			continue
		}
		if (lower === 'tomorrow') {
			dueAt = atNineAm(1)
			continue
		}
		const dayIdx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(
			lower,
		)
		if (dayIdx !== -1) {
			const now = new Date()
			const diff = (dayIdx - now.getDay() + 7) % 7 || 7
			dueAt = atNineAm(diff)
			continue
		}
		if (lower === 'in' && i + 1 < tokens.length) {
			const rawNext = tokens[i + 1]
			const next = rawNext === undefined ? '' : rawNext.toLowerCase()
			const m = next.match(/^(\d+)(d|w)$/)
			if (m) {
				const n = Number(m[1])
				const unit = m[2] === 'w' ? 7 : 1
				dueAt = atNineAm(n * unit)
				i += 1
				continue
			}
		}
		kept.push(tok)
	}

	const title = kept.join(' ').trim()
	if (title.length === 0) return null
	return { title, dueAt, priority }
}

function atNineAm(daysFromNow: number): Date {
	const d = new Date()
	d.setHours(9, 0, 0, 0)
	d.setDate(d.getDate() + daysFromNow)
	return d
}

// ── Styles ────────────────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'TasksPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-xl);
`

const Intro = styled.div.withConfig({ displayName: 'TasksIntro' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);
	align-items: end;

	@media (min-width: 768px) {
		grid-template-columns: 1fr auto;
	}
`

const IntroText = styled.div.withConfig({ displayName: 'TasksIntroText' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Title = styled.h2.withConfig({ displayName: 'TasksTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'TasksSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const KpiRow = styled.div.withConfig({ displayName: 'TasksKpiRow' })`
	display: flex;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

const Layout = styled.div.withConfig({ displayName: 'TasksLayout' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: 14rem 1fr;
	}
`

const Rail = styled.nav.withConfig({ displayName: 'TasksRail' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 0;
`

const RailButton = styled.button.withConfig({
	displayName: 'TasksRailButton',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	${agedPaperSurface}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-xs);
	padding: var(--space-xs) var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	border: 1px solid
		${p =>
			p.$active
				? 'color-mix(in srgb, var(--color-primary) 55%, transparent)'
				: 'transparent'};
	border-radius: var(--shape-2xs);
	cursor: pointer;
	transition: border-color 140ms ease, background 140ms ease;

	&:hover,
	&:focus-visible {
		border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
		outline: none;
	}
`

const RailDivider = styled.hr.withConfig({ displayName: 'TasksRailDivider' })`
	border: none;
	border-top: 1px solid color-mix(in srgb, var(--color-on-surface) 15%, transparent);
	margin: var(--space-xs) 0;
`

const Count = styled.span.withConfig({ displayName: 'TasksRailCount' })`
	${brushedMetalPlate}
	padding: var(--space-3xs) var(--space-xs);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface);
	border-radius: var(--shape-2xs);
`

const Column = styled.div.withConfig({ displayName: 'TasksColumn' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	min-width: 0;
`

const Stack = styled.div.withConfig({ displayName: 'TasksStack' })`
	display: flex;
	flex-direction: column;
	gap: 0;
`

const QuickAddRow = styled.form.withConfig({ displayName: 'TasksQuickAddRow' })`
	display: grid;
	grid-template-columns: 1fr auto;
	gap: var(--space-sm);
	align-items: center;
`

const QuickAddInput = styled(PriInput).withConfig({
	displayName: 'TasksQuickAddInput',
})`
	font-size: var(--typescale-body-medium-size);
`

const QuickAddButton = styled.button.withConfig({
	displayName: 'TasksQuickAddButton',
})`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-xs) var(--space-md);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	border-radius: var(--shape-2xs);
	cursor: pointer;

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const DetailMeta = styled.div.withConfig({ displayName: 'TasksDetailMeta' })`
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--space-sm);
`

const DetailField = styled.div.withConfig({ displayName: 'TasksDetailField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const DetailLabel = styled.span.withConfig({
	displayName: 'TasksDetailLabel',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const DetailValue = styled.span.withConfig({
	displayName: 'TasksDetailValue',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const ActionRow = styled.div.withConfig({ displayName: 'TasksActionRow' })`
	display: flex;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

const EventsHeader = styled.h3.withConfig({ displayName: 'TasksEventsHeader' })`
	${stenciledTitle}
	font-size: var(--typescale-title-small-size);
	margin: 0;
`

const EventsList = styled.ol.withConfig({ displayName: 'TasksEventsList' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	list-style: none;
	padding: 0;
	margin: 0;
`

const EventRow = styled.li.withConfig({ displayName: 'TasksEventRow' })`
	display: grid;
	grid-template-columns: auto 1fr auto;
	gap: var(--space-sm);
	align-items: center;
	padding: var(--space-2xs) var(--space-sm);
	background: color-mix(in srgb, var(--color-paper-fibre-a) 40%, transparent);
	border-bottom: 1px solid color-mix(in srgb, var(--color-on-surface) 10%, transparent);
`

const EventActor = styled.span.withConfig({ displayName: 'TasksEventActor' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--color-on-surface-variant);
`

const EventSummary = styled.span.withConfig({
	displayName: 'TasksEventSummary',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const EventAt = styled.span.withConfig({ displayName: 'TasksEventAt' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const EmptyAudit = styled.p.withConfig({ displayName: 'TasksEmptyAudit' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`
