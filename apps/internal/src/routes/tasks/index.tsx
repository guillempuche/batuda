import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useCallback, useMemo } from 'react'
import styled from 'styled-components'

import { companiesListAtom, openTasksAtom } from '#/atoms/pipeline-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { SectionHeader } from '#/components/shared/section-header'
import { TaskItem, type TaskItemData } from '#/components/shared/task-item'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { ForjaApiAtom } from '#/lib/forja-api-atom'

type TaskRow = {
	readonly id: string
	readonly companyId: string
	readonly type: string
	readonly title: string
	readonly dueAt: string | null
	readonly completedAt: string | null
}

type CompanyLookup = {
	readonly id: string
	readonly slug: string
	readonly name: string
}

/**
 * Server-side loader: fetches open tasks + companies in parallel (same
 * atoms the dashboard uses). Reuses `openTasksAtom` + `companiesListAtom`
 * so navigating Dashboard → Tasks → Dashboard never double-fetches.
 */
async function loadTasksOnServer(): Promise<{
	tasks: ReadonlyArray<unknown>
	companies: ReadonlyArray<unknown>
}> {
	const [{ Effect }, { getRequestHeader }, { makeForjaApiServer }] =
		await Promise.all([
			import('effect'),
			import('@tanstack/react-start/server'),
			import('#/lib/forja-api-server'),
		])
	const cookie = getRequestHeader('cookie')
	const program = Effect.gen(function* () {
		const client = yield* makeForjaApiServer(cookie)
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

const completeTaskAtom = ForjaApiAtom.mutation('tasks', 'complete')

function TasksPage() {
	const { t } = useLingui()
	const tasksResult = useAtomValue(openTasksAtom)
	const companiesResult = useAtomValue(companiesListAtom)
	const refreshTasks = useAtomRefresh(openTasksAtom)
	const refreshCompanies = useAtomRefresh(companiesListAtom)
	const completeTask = useAtomSet(completeTaskAtom, { mode: 'promiseExit' })
	const { open: openQuickCapture } = useQuickCapture()

	const tasks = useMemo<ReadonlyArray<TaskRow>>(
		() =>
			AsyncResult.isSuccess(tasksResult) ? narrowTasks(tasksResult.value) : [],
		[tasksResult],
	)

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

	const isLoading =
		AsyncResult.isInitial(tasksResult) || AsyncResult.isInitial(companiesResult)

	const now = Date.now()
	const sevenDaysOut = now + 7 * 86400_000

	const { overdue, today, thisWeek, later, noDue } = useMemo(() => {
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
			if (dueMs < startOfDay(now)) {
				overdue.push(task)
			} else if (isSameDay(dueMs, now)) {
				today.push(task)
			} else if (dueMs < sevenDaysOut) {
				thisWeek.push(task)
			} else {
				later.push(task)
			}
		}

		// Sort each bucket: most urgent first
		const byDue = (a: TaskRow, b: TaskRow) =>
			Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? '')
		overdue.sort(byDue)
		today.sort(byDue)
		thisWeek.sort(byDue)
		later.sort(byDue)

		return { overdue, today, thisWeek, later, noDue }
	}, [tasks, now, sevenDaysOut])

	const handleToggleTask = useCallback(
		async (taskId: string) => {
			await completeTask({ params: { id: taskId } })
			refreshTasks()
			refreshCompanies()
		},
		[completeTask, refreshTasks, refreshCompanies],
	)

	const handleLogInteraction = useCallback(
		(companyId: string) => {
			const company = companiesById.get(companyId)
			if (!company) return
			openQuickCapture({
				companyId: company.id,
				companyName: company.name,
				onSubmitted: () => {
					refreshTasks()
					refreshCompanies()
				},
			})
		},
		[companiesById, openQuickCapture, refreshTasks, refreshCompanies],
	)

	const toTaskItemData = useCallback(
		(task: TaskRow): TaskItemData => {
			const company = companiesById.get(task.companyId)
			return {
				id: task.id,
				title: task.title,
				dueAt: task.dueAt,
				companyId: task.companyId,
				companyName: company?.name ?? t`Unknown company`,
				...(company?.slug !== undefined ? { companySlug: company.slug } : {}),
			}
		},
		[companiesById, t],
	)

	if (isLoading) {
		return (
			<Page>
				<LoadingSpinner />
			</Page>
		)
	}

	if (tasks.length === 0) {
		return (
			<Page>
				<Intro>
					<Title>
						<Trans>Tasks</Trans>
					</Title>
				</Intro>
				<EmptyState
					title={t`All under control`}
					description={t`No pending tasks. Time to celebrate or prospect new leads.`}
				/>
			</Page>
		)
	}

	return (
		<Page>
			<Intro>
				<Title>
					<Trans>Tasks</Trans>
				</Title>
				<Subtitle>
					<Trans>
						{tasks.length} open {tasks.length === 1 ? 'task' : 'tasks'}
					</Trans>
				</Subtitle>
			</Intro>

			{overdue.length > 0 && (
				<BucketSection>
					<SectionHeader title={t`Overdue`} count={overdue.length} />
					<Stack>
						{overdue.map(task => (
							<TaskItem
								key={task.id}
								task={toTaskItemData(task)}
								completed={false}
								overdue
								onToggle={() => {
									void handleToggleTask(task.id)
								}}
								onLogInteraction={() => handleLogInteraction(task.companyId)}
							/>
						))}
					</Stack>
				</BucketSection>
			)}

			{today.length > 0 && (
				<BucketSection>
					<SectionHeader title={t`Today`} count={today.length} />
					<Stack>
						{today.map(task => (
							<TaskItem
								key={task.id}
								task={toTaskItemData(task)}
								completed={false}
								onToggle={() => {
									void handleToggleTask(task.id)
								}}
								onLogInteraction={() => handleLogInteraction(task.companyId)}
							/>
						))}
					</Stack>
				</BucketSection>
			)}

			{thisWeek.length > 0 && (
				<BucketSection>
					<SectionHeader title={t`This week`} count={thisWeek.length} />
					<Stack>
						{thisWeek.map(task => (
							<TaskItem
								key={task.id}
								task={toTaskItemData(task)}
								completed={false}
								onToggle={() => {
									void handleToggleTask(task.id)
								}}
								onLogInteraction={() => handleLogInteraction(task.companyId)}
							/>
						))}
					</Stack>
				</BucketSection>
			)}

			{later.length > 0 && (
				<BucketSection>
					<SectionHeader title={t`Later`} count={later.length} />
					<Stack>
						{later.map(task => (
							<TaskItem
								key={task.id}
								task={toTaskItemData(task)}
								completed={false}
								onToggle={() => {
									void handleToggleTask(task.id)
								}}
								onLogInteraction={() => handleLogInteraction(task.companyId)}
							/>
						))}
					</Stack>
				</BucketSection>
			)}

			{noDue.length > 0 && (
				<BucketSection>
					<SectionHeader title={t`No due date`} count={noDue.length} />
					<Stack>
						{noDue.map(task => (
							<TaskItem
								key={task.id}
								task={toTaskItemData(task)}
								completed={false}
								onToggle={() => {
									void handleToggleTask(task.id)
								}}
								onLogInteraction={() => handleLogInteraction(task.companyId)}
							/>
						))}
					</Stack>
				</BucketSection>
			)}
		</Page>
	)
}

// ── Helpers ──────────────────────────────────────────────────────

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

function narrowTasks(rows: ReadonlyArray<unknown>): ReadonlyArray<TaskRow> {
	const out: Array<TaskRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['companyId'] !== 'string') continue
		if (typeof r['type'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		out.push({
			id: r['id'],
			companyId: r['companyId'],
			type: r['type'],
			title: r['title'],
			dueAt: typeof r['dueAt'] === 'string' ? r['dueAt'] : null,
			completedAt:
				typeof r['completedAt'] === 'string' ? r['completedAt'] : null,
		})
	}
	return out
}

// ── Styles ───────────────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'TasksPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-xl);
`

const Intro = styled.div.withConfig({ displayName: 'TasksIntro' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const Title = styled.h2.withConfig({ displayName: 'TasksTitle' })`
	font-family: var(--font-display);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'TasksSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const BucketSection = styled.section.withConfig({
	displayName: 'TasksBucketSection',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Stack = styled.div.withConfig({ displayName: 'TasksStack' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`
