import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Clock, History, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput } from '@batuda/ui/pri'

import { companiesListAtom, openTasksAtom } from '#/atoms/pipeline-atoms'
import {
	cancelTaskAtom,
	createTaskAtom,
	doneTasksAtom,
	reopenTaskAtom,
	rescheduleTaskAtom,
	snoozedTasksAtom,
	snoozeTaskAtom,
	taskEventsAtomFor,
	updateTaskAtom,
} from '#/atoms/tasks-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { KpiCounter } from '#/components/shared/kpi-counter'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import {
	TaskItem,
	type TaskItemData,
	type TaskPriorityLabel,
	type TaskSourceLabel,
} from '#/components/shared/task-item'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperSurface,
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Task inbox — extends `openTasksAtom` (dashboard) with a smart-view rail
 * (today / overdue / this week / later / no due / snoozed / done 7d),
 * inline edit on title + due, and a right-pane detail editor backed by
 * `task_events`. Mutations go through `@batuda/controllers` typed atoms
 * so optimistic concurrency (`If-Match`) is cheap to enable later.
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

type SmartView =
	| 'today'
	| 'overdue'
	| 'this-week'
	| 'later'
	| 'no-due'
	| 'snoozed'
	| 'done'

const completeTaskAtom = BatudaApiAtom.mutation('tasks', 'complete')

async function loadTasksOnServer(): Promise<{
	tasks: ReadonlyArray<unknown>
	companies: ReadonlyArray<unknown>
}> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		const [tasks, companies] = yield* Effect.all(
			[
				client.tasks.list({ query: { completed: 'false' } }),
				client.companies.list({ query: { limit: 500 } }),
			],
			{ concurrency: 2 },
		)
		return { tasks, companies }
	})
	return Effect.runPromise(program)
}

export const Route = createFileRoute('/tasks/')({
	loader: async () => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const { tasks, companies } = await loadTasksOnServer()
			return {
				dehydrated: [
					dehydrateAtom(openTasksAtom, AsyncResult.success(tasks)),
					dehydrateAtom(companiesListAtom, AsyncResult.success(companies)),
				] as const,
			}
		} catch (error) {
			console.warn('[TasksLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	component: TasksPage,
})

function TasksPage() {
	const { t } = useLingui()
	const tasksResult = useAtomValue(openTasksAtom)
	const snoozedResult = useAtomValue(snoozedTasksAtom)
	const doneResult = useAtomValue(doneTasksAtom)
	const companiesResult = useAtomValue(companiesListAtom)
	const refreshTasks = useAtomRefresh(openTasksAtom)
	const refreshSnoozed = useAtomRefresh(snoozedTasksAtom)
	const refreshDone = useAtomRefresh(doneTasksAtom)
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

	const [selectedView, setSelectedView] = useState<SmartView>('today')
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
	const [undoOpen, setUndoOpen] = useState(false)
	const quickAddRef = useRef<HTMLInputElement | null>(null)

	const openTasks = useMemo<ReadonlyArray<TaskRow>>(
		() =>
			AsyncResult.isSuccess(tasksResult) ? narrowTasks(tasksResult.value) : [],
		[tasksResult],
	)
	const snoozedTasks = useMemo<ReadonlyArray<TaskRow>>(
		() =>
			AsyncResult.isSuccess(snoozedResult)
				? narrowTasks(snoozedResult.value).filter(
						t =>
							t.snoozedUntil !== null &&
							Date.parse(t.snoozedUntil) > Date.now(),
					)
				: [],
		[snoozedResult],
	)
	const doneTasks = useMemo<ReadonlyArray<TaskRow>>(() => {
		if (!AsyncResult.isSuccess(doneResult)) return []
		const cutoff = Date.now() - 7 * 86400_000
		return narrowTasks(doneResult.value).filter(
			t => t.completedAt !== null && Date.parse(t.completedAt) >= cutoff,
		)
	}, [doneResult])

	const companiesById = useMemo<Map<string, CompanyLookup>>(() => {
		if (!AsyncResult.isSuccess(companiesResult)) return new Map()
		const map = new Map<string, CompanyLookup>()
		for (const row of companiesResult.value as ReadonlyArray<unknown>) {
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

	const buckets = useMemo(() => bucketise(openTasks), [openTasks])

	const visibleTasks = useMemo<ReadonlyArray<TaskRow>>(() => {
		switch (selectedView) {
			case 'today':
				return buckets.today
			case 'overdue':
				return buckets.overdue
			case 'this-week':
				return buckets.thisWeek
			case 'later':
				return buckets.later
			case 'no-due':
				return buckets.noDue
			case 'snoozed':
				return snoozedTasks
			case 'done':
				return doneTasks
		}
	}, [selectedView, buckets, snoozedTasks, doneTasks])

	const refreshAll = useCallback(() => {
		refreshTasks()
		refreshSnoozed()
		refreshDone()
		refreshCompanies()
	}, [refreshTasks, refreshSnoozed, refreshDone, refreshCompanies])

	// Refresh when the window regains focus — catches webhook-driven
	// edits (an agent updated a task in another tab or via MCP).
	useEffect(() => {
		const onFocus = () => refreshAll()
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	}, [refreshAll])

	const handleToggle = useCallback(
		async (taskId: string, nextCompleted: boolean) => {
			if (nextCompleted) {
				await completeTask({ params: { id: taskId } } as never)
			} else {
				await reopenTask({ params: { id: taskId } } as never)
			}
			refreshAll()
		},
		[completeTask, reopenTask, refreshAll],
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
			return {
				id: task.id,
				title: task.title,
				dueAt: task.dueAt,
				companyId: task.companyId ?? '',
				companyName: company?.name ?? t`Personal`,
				priority: task.priority,
				source: task.source,
				...(company?.slug !== undefined ? { companySlug: company.slug } : {}),
			}
		},
		[companiesById, t],
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
				setSelectedView('overdue')
				setGPrimed(false)
				return
			}
			if (gPrimed && ev.key === 't') {
				ev.preventDefault()
				setSelectedView('today')
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
				if (next) setSelectedTaskId(next.id)
				return
			}
			if (ev.key === 'k') {
				ev.preventDefault()
				const prevIdx = Math.max(0, currentIdx - 1)
				const prev = visibleTasks[prevIdx]
				if (prev) setSelectedTaskId(prev.id)
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
	}, [gPrimed, visibleTasks, selectedTaskId, handleToggle, handleSnooze])

	const isLoading =
		AsyncResult.isInitial(tasksResult) || AsyncResult.isInitial(companiesResult)

	if (isLoading) {
		return (
			<Page>
				<LoadingSpinner />
			</Page>
		)
	}

	const selectedTask =
		selectedTaskId !== null
			? (visibleTasks.find(r => r.id === selectedTaskId) ??
				openTasks.find(r => r.id === selectedTaskId) ??
				null)
			: null

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
					<KpiCounter value={openTasks.length} label={t`Open`} />
					{buckets.overdue.length > 0 && (
						<KpiCounter value={buckets.overdue.length} label={t`Overdue`} />
					)}
				</KpiRow>
			</Intro>

			<Layout>
				<Rail>
					<RailButton
						$active={selectedView === 'today'}
						type='button'
						onClick={() => setSelectedView('today')}
					>
						<Trans>Today</Trans>
						<Count>{buckets.today.length}</Count>
					</RailButton>
					<RailButton
						$active={selectedView === 'overdue'}
						type='button'
						onClick={() => setSelectedView('overdue')}
					>
						<Trans>Overdue</Trans>
						<Count>{buckets.overdue.length}</Count>
					</RailButton>
					<RailButton
						$active={selectedView === 'this-week'}
						type='button'
						onClick={() => setSelectedView('this-week')}
					>
						<Trans>This week</Trans>
						<Count>{buckets.thisWeek.length}</Count>
					</RailButton>
					<RailButton
						$active={selectedView === 'later'}
						type='button'
						onClick={() => setSelectedView('later')}
					>
						<Trans>Later</Trans>
						<Count>{buckets.later.length}</Count>
					</RailButton>
					<RailButton
						$active={selectedView === 'no-due'}
						type='button'
						onClick={() => setSelectedView('no-due')}
					>
						<Trans>No due date</Trans>
						<Count>{buckets.noDue.length}</Count>
					</RailButton>
					<RailButton
						$active={selectedView === 'snoozed'}
						type='button'
						onClick={() => setSelectedView('snoozed')}
					>
						<Trans>Snoozed</Trans>
						<Count>{snoozedTasks.length}</Count>
					</RailButton>
					<RailButton
						$active={selectedView === 'done'}
						type='button'
						onClick={() => setSelectedView('done')}
					>
						<Trans>Done 7d</Trans>
						<Count>{doneTasks.length}</Count>
					</RailButton>
					<RailDivider aria-hidden />
					<RailButton
						$active={false}
						type='button'
						onClick={() => setUndoOpen(true)}
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

					{visibleTasks.length === 0 ? (
						<EmptyState
							title={emptyTitle(selectedView, t)}
							description={emptyDescription(selectedView, t)}
						/>
					) : (
						<Stack>
							{visibleTasks.map(task => {
								const companyId = task.companyId
								const logInteractionProps =
									companyId !== null
										? {
												onLogInteraction: () => handleLogInteraction(companyId),
											}
										: {}
								return (
									<TaskItem
										key={task.id}
										task={toTaskItemData(task)}
										completed={task.status === 'done'}
										overdue={
											selectedView === 'overdue' ||
											(task.dueAt !== null &&
												Date.parse(task.dueAt) < startOfDay(Date.now()))
										}
										onToggle={next => void handleToggle(task.id, next)}
										onEditTitle={next => handleEditTitle(task.id, next)}
										onEditDue={next => handleReschedule(task.id, next)}
										onOpenDetail={() => setSelectedTaskId(task.id)}
										{...logInteractionProps}
									/>
								)
							})}
						</Stack>
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
					onClose={() => setSelectedTaskId(null)}
					onSnooze={() => void handleSnooze(selectedTask.id)}
					onCancel={() => void handleCancel(selectedTask.id)}
					onToggle={next => void handleToggle(selectedTask.id, next)}
				/>
			)}

			<UndoDialog
				open={undoOpen}
				onOpenChange={setUndoOpen}
				tasks={openTasks}
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
			onSubmit={e => {
				e.preventDefault()
				void submit()
			}}
		>
			<QuickAddInput
				ref={inputRef}
				value={value}
				onChange={e => setValue(e.target.value)}
				placeholder={placeholder}
				disabled={pending}
				aria-label={t`Quick add task`}
			/>
			<QuickAddButton type='submit' disabled={pending || value.trim() === ''}>
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
				<PriDialog.Popup>
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
						<PriButton onClick={() => onToggle(task.status !== 'done')}>
							{task.status === 'done' ? t`Reopen` : t`Complete`}
						</PriButton>
						<PriButton $variant='text' onClick={onSnooze}>
							<Clock size={12} aria-hidden />
							<Trans>Snooze 1d</Trans>
						</PriButton>
						<PriButton $variant='text' onClick={onCancel}>
							<Trans>Cancel</Trans>
						</PriButton>
					</ActionRow>

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
	// Pull the latest `updated_at` from the already-loaded task list.
	// A full cross-task event feed endpoint is out of scope for PR #4;
	// per-task audit lives in the detail pane.
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
				<PriDialog.Popup>
					<PriDialog.Title>
						<Trans>Recent changes</Trans>
					</PriDialog.Title>
					<PriDialog.Description>
						<Trans>
							The 20 most recently edited open tasks. Click one to reopen it.
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

function isSameDay(a: number, b: number): boolean {
	const da = new Date(a)
	const db = new Date(b)
	return (
		da.getFullYear() === db.getFullYear() &&
		da.getMonth() === db.getMonth() &&
		da.getDate() === db.getDate()
	)
}

function bucketise(tasks: ReadonlyArray<TaskRow>) {
	const now = Date.now()
	const sevenDaysOut = now + 7 * 86400_000
	const overdue: TaskRow[] = []
	const today: TaskRow[] = []
	const thisWeek: TaskRow[] = []
	const later: TaskRow[] = []
	const noDue: TaskRow[] = []
	for (const task of tasks) {
		if (task.dueAt === null) {
			noDue.push(task)
			continue
		}
		const dueMs = Date.parse(task.dueAt)
		if (dueMs < startOfDay(now)) overdue.push(task)
		else if (isSameDay(dueMs, now)) today.push(task)
		else if (dueMs < sevenDaysOut) thisWeek.push(task)
		else later.push(task)
	}
	const byDue = (a: TaskRow, b: TaskRow) =>
		Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? '')
	overdue.sort(byDue)
	today.sort(byDue)
	thisWeek.sort(byDue)
	later.sort(byDue)
	return { overdue, today, thisWeek, later, noDue }
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
			companyId:
				typeof r['company_id'] === 'string'
					? r['company_id']
					: typeof r['companyId'] === 'string'
						? r['companyId']
						: null,
			type: typeof r['type'] === 'string' ? r['type'] : 'other',
			title: r['title'],
			status: typeof r['status'] === 'string' ? r['status'] : 'open',
			priority,
			source,
			dueAt: pickString(r, 'due_at', 'dueAt'),
			snoozedUntil: pickString(r, 'snoozed_until', 'snoozedUntil'),
			completedAt: pickString(r, 'completed_at', 'completedAt'),
			updatedAt: pickString(r, 'updated_at', 'updatedAt'),
		})
	}
	return out
}

function pickString(
	r: Record<string, unknown>,
	snake: string,
	camel: string,
): string | null {
	const snakeV = r[snake]
	if (typeof snakeV === 'string') return snakeV
	const camelV = r[camel]
	if (typeof camelV === 'string') return camelV
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
		const at = pickString(r, 'at', 'at')
		if (at === null) continue
		const actorKind =
			typeof r['actor_kind'] === 'string'
				? r['actor_kind']
				: typeof r['actorKind'] === 'string'
					? r['actorKind']
					: 'user'
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

function emptyTitle(view: SmartView, t: (s: TemplateStringsArray) => string) {
	switch (view) {
		case 'today':
			return t`All under control`
		case 'overdue':
			return t`Nothing overdue`
		case 'this-week':
			return t`No tasks this week`
		case 'later':
			return t`Nothing later in the queue`
		case 'no-due':
			return t`Every task has a date`
		case 'snoozed':
			return t`Nothing snoozed`
		case 'done':
			return t`Nothing completed recently`
	}
}

function emptyDescription(
	view: SmartView,
	t: (s: TemplateStringsArray) => string,
) {
	switch (view) {
		case 'today':
			return t`No pending tasks today. Time to prospect or take a walk.`
		case 'overdue':
			return t`The ledger is clean.`
		case 'this-week':
			return t`The week is clear — good time to plan.`
		case 'later':
			return t`No tasks scheduled beyond this week.`
		case 'no-due':
			return t`Every open task has a due date assigned.`
		case 'snoozed':
			return t`No tasks are sleeping.`
		case 'done':
			return t`No tasks completed in the last 7 days.`
	}
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
