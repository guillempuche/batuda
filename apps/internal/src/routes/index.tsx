import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { motion } from 'motion/react'
import { useCallback, useMemo } from 'react'
import styled from 'styled-components'

import { companiesListAtom, openTasksAtom } from '#/atoms/pipeline-atoms'
import { CompanyCard } from '#/components/shared/company-card'
import { EmptyState } from '#/components/shared/empty-state'
import { KpiCounter } from '#/components/shared/kpi-counter'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { SectionHeader } from '#/components/shared/section-header'
import {
	type CompanyStatus,
	StatusBadge,
} from '#/components/shared/status-badge'
import { TaskItem } from '#/components/shared/task-item'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { ForjaApiAtom } from '#/lib/forja-api-atom'
import { rulerUnderRule, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Narrow shapes the dashboard needs. The server API currently encodes
 * responses as `Schema.Unknown`, so we perform runtime narrowing at the
 * boundary. Promoting these to a shared typed schema is a follow-up.
 */
type DashboardCompany = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly industry: string | null
	readonly location: string | null
	readonly region: string | null
	readonly priority: number | null
	readonly lastContactedAt: string | null
	readonly nextAction: string | null
	readonly nextActionAt: string | null
}

type DashboardTask = {
	readonly id: string
	readonly companyId: string
	readonly type: string
	readonly title: string
	readonly dueAt: string | null
	readonly completedAt: string | null
}

type PipelineData = {
	readonly companies: ReadonlyArray<unknown>
	readonly openTasks: ReadonlyArray<unknown>
}

/**
 * Server-only pipeline data fetch. Dynamically imports the server client
 * so Vite excludes it from the client bundle, and reads the incoming
 * request cookie via `getRequestHeader` to forward the Better-Auth
 * session on to the API server.
 */
async function loadPipelineDataOnServer(): Promise<PipelineData> {
	const [{ Effect }, { getRequestHeader }, { makeForjaApiServer }] =
		await Promise.all([
			import('effect'),
			import('@tanstack/react-start/server'),
			import('#/lib/forja-api-server'),
		])
	const cookie = getRequestHeader('cookie')
	const program = Effect.gen(function* () {
		const client = yield* makeForjaApiServer(cookie)
		const [companies, openTasks] = yield* Effect.all(
			[
				client.companies.list({ query: { limit: 500 } }),
				client.tasks.list({ query: { completed: 'false' } }),
			],
			{ concurrency: 2 },
		)
		return { companies, openTasks } as PipelineData
	})
	return Effect.runPromise(program)
}

export const Route = createFileRoute('/')({
	loader: async () => {
		if (!import.meta.env.SSR) {
			// Client-side navigation: let the atoms refetch directly via
			// `ForjaApiAtom` using the browser's session cookie. Returning
			// an empty dehydration leaves the registry alone and the
			// component renders the loading state.
			return { dehydrated: [] as const }
		}
		try {
			const { companies, openTasks } = await loadPipelineDataOnServer()
			return {
				dehydrated: [
					dehydrateAtom(companiesListAtom, AsyncResult.success(companies)),
					dehydrateAtom(openTasksAtom, AsyncResult.success(openTasks)),
				] as const,
			}
		} catch (error) {
			// Expected in unauthenticated contexts (401 from SessionMiddleware)
			// or when the API is down. Fall back to empty hydration — the
			// atoms will land in `Initial`, the component renders the loading
			// state, and the client-side fetch (with browser cookies) gets
			// a second chance. See server.log for the underlying cause.
			console.warn('[PipelineLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	component: PipelinePage,
})

/**
 * Module-scoped mutation atom. `Atom.family` inside `AtomHttpApi.mutation`
 * caches by the `{ group, endpoint, responseMode }` key, so pulling the
 * atom identity out here guarantees the same instance is used by every
 * render of the dashboard. `useAtomSet` wraps it into a writable setter.
 */
const completeTaskAtom = ForjaApiAtom.mutation('tasks', 'complete')

/**
 * Pipeline dashboard — answers three questions in under three seconds:
 *   1. What needs my attention right now? (overdue + stale pipeline)
 *   2. What's due today / this week? (task buckets)
 *   3. What does my pipeline look like? (status strip)
 *
 * Data flows via two shared atoms (`companiesListAtom`, `openTasksAtom`)
 * hydrated from the loader's SSR pairs, so first paint has real data.
 * Post-mutation refreshes use `useAtomRefresh` on both atoms.
 */
function PipelinePage() {
	const { t } = useLingui()
	const companiesResult = useAtomValue(companiesListAtom)
	const openTasksResult = useAtomValue(openTasksAtom)
	const refreshCompanies = useAtomRefresh(companiesListAtom)
	const refreshTasks = useAtomRefresh(openTasksAtom)
	const completeTask = useAtomSet(completeTaskAtom, { mode: 'promiseExit' })
	const { open: openQuickCapture } = useQuickCapture()

	const handleLogInteraction = useCallback(
		(company: DashboardCompany) => {
			openQuickCapture({
				companyId: company.id,
				companyName: company.name,
			})
		},
		[openQuickCapture],
	)

	const handleToggleTask = useCallback(
		async (taskId: string) => {
			// Fire-and-forget complete — the task only toggles off-pending,
			// so we don't need a "next" argument. On success refresh both
			// atoms (the task disappears from `openTasks`; the company row
			// may inherit updated next-action fields on the server side).
			await completeTask({ params: { id: taskId } })
			refreshTasks()
			refreshCompanies()
		},
		[completeTask, refreshCompanies, refreshTasks],
	)

	const companies = useMemo<ReadonlyArray<DashboardCompany>>(
		() =>
			AsyncResult.isSuccess(companiesResult)
				? narrowCompanies(companiesResult.value)
				: [],
		[companiesResult],
	)
	const openTasks = useMemo<ReadonlyArray<DashboardTask>>(
		() =>
			AsyncResult.isSuccess(openTasksResult)
				? narrowTasks(openTasksResult.value)
				: [],
		[openTasksResult],
	)

	const isLoading =
		AsyncResult.isInitial(companiesResult) ||
		AsyncResult.isInitial(openTasksResult)

	const now = Date.now()
	const fourteenDaysAgo = now - 14 * 86400_000
	const sevenDaysOut = now + 7 * 86400_000

	const statusCounts = useMemo(() => countByStatus(companies), [companies])

	const overdueTasks = useMemo(
		() =>
			openTasks
				.filter(task => task.dueAt !== null && Date.parse(task.dueAt) < now)
				.sort(
					(a, b) =>
						(a.dueAt ? Date.parse(a.dueAt) : 0) -
						(b.dueAt ? Date.parse(b.dueAt) : 0),
				),
		[openTasks, now],
	)

	const overdueCompanies = useMemo(
		() =>
			companies.filter(
				company =>
					company.nextActionAt !== null &&
					Date.parse(company.nextActionAt) < now,
			),
		[companies, now],
	)

	const staleInPipeline = useMemo(
		() =>
			companies.filter(company => {
				if (!STALE_STATUSES.has(company.status)) return false
				if (company.lastContactedAt === null) return true
				return Date.parse(company.lastContactedAt) < fourteenDaysAgo
			}),
		[companies, fourteenDaysAgo],
	)

	const todayTasks = useMemo(
		() => openTasks.filter(task => task.dueAt && isSameDay(task.dueAt, now)),
		[openTasks, now],
	)
	const weekTasks = useMemo(
		() =>
			openTasks.filter(task => {
				if (!task.dueAt) return false
				const due = Date.parse(task.dueAt)
				return due > now && due < sevenDaysOut
			}),
		[openTasks, now, sevenDaysOut],
	)

	const topPriorities = useMemo(
		() =>
			companies
				.filter(
					company => company.priority === 1 && company.nextActionAt === null,
				)
				.slice(0, 5),
		[companies],
	)

	if (isLoading) {
		return (
			<Page>
				<LoadingSpinner />
			</Page>
		)
	}

	const overdueTasksCount = overdueTasks.length

	return (
		<Page>
			<Intro>
				<Title>
					<Trans>Pipeline</Trans>
				</Title>
				<Subtitle>
					<Trans>Workshop floor — live counters on the bench.</Trans>
				</Subtitle>
			</Intro>

			<KpiRow>
				<KpiCounter value={companies.length} label={t`Active companies`} />
				<KpiCounter value={openTasks.length} label={t`Open tasks`} />
				<KpiCounter value={overdueTasksCount} label={t`Overdue`} />
			</KpiRow>

			<StatusStrip>
				{STATUS_ORDER.map(status => (
					<StatusChip key={status}>
						<StatusBadge status={status} size='lg' />
						<StatusCount>{statusCounts.get(status) ?? 0}</StatusCount>
					</StatusChip>
				))}
			</StatusStrip>

			<Section
				initial={{ opacity: 0, y: 12 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true, amount: 0.2 }}
			>
				<SectionHeader
					title={t`Needs attention`}
					count={
						overdueTasks.length +
						overdueCompanies.length +
						staleInPipeline.length
					}
				/>
				{overdueTasks.length === 0 &&
				overdueCompanies.length === 0 &&
				staleInPipeline.length === 0 ? (
					<EmptyState
						title={t`All under control`}
						description={t`No overdue tasks, no pending follow-ups, no neglected companies.`}
					/>
				) : (
					<Stack>
						{overdueTasks.slice(0, 5).map(task => {
							const company = companies.find(c => c.id === task.companyId)
							return (
								<TaskItem
									key={task.id}
									task={{
										id: task.id,
										title: task.title,
										dueAt: task.dueAt,
										companyId: task.companyId,
										companyName: company?.name ?? t`Company`,
										...(company?.slug !== undefined
											? { companySlug: company.slug }
											: {}),
									}}
									completed={false}
									overdue
									onToggle={() => {
										void handleToggleTask(task.id)
									}}
									{...(company
										? {
												onLogInteraction: () => handleLogInteraction(company),
											}
										: {})}
								/>
							)
						})}
						{overdueCompanies.slice(0, 5).map(company => (
							<CompanyCard
								key={company.id}
								company={{
									slug: company.slug,
									name: company.name,
									status: company.status,
									industry: company.industry,
									location: company.location,
									priority: company.priority,
									lastContactedAt: company.lastContactedAt,
								}}
								actions={{
									onLogInteraction: () => handleLogInteraction(company),
								}}
							/>
						))}
						{staleInPipeline.slice(0, 5).map(company => (
							<CompanyCard
								key={`stale-${company.id}`}
								company={{
									slug: company.slug,
									name: company.name,
									status: company.status,
									industry: company.industry,
									location: company.location,
									priority: company.priority,
									lastContactedAt: company.lastContactedAt,
								}}
								actions={{
									onLogInteraction: () => handleLogInteraction(company),
								}}
							/>
						))}
					</Stack>
				)}
			</Section>

			<TwoColumn>
				<Section
					initial={{ opacity: 0, y: 12 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, amount: 0.2 }}
				>
					<SectionHeader title={t`Today`} count={todayTasks.length} />
					{todayTasks.length === 0 ? (
						<EmptyState title={t`No tasks for today`} />
					) : (
						<Stack>
							{todayTasks.map(task => {
								const company = companies.find(c => c.id === task.companyId)
								return (
									<TaskItem
										key={task.id}
										task={{
											id: task.id,
											title: task.title,
											dueAt: task.dueAt,
											companyId: task.companyId,
											companyName: company?.name ?? t`Company`,
											...(company?.slug !== undefined
												? { companySlug: company.slug }
												: {}),
										}}
										completed={false}
										onToggle={() => {
											void handleToggleTask(task.id)
										}}
										{...(company
											? {
													onLogInteraction: () => handleLogInteraction(company),
												}
											: {})}
									/>
								)
							})}
						</Stack>
					)}
				</Section>
				<Section
					initial={{ opacity: 0, y: 12 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, amount: 0.2 }}
				>
					<SectionHeader title={t`This week`} count={weekTasks.length} />
					{weekTasks.length === 0 ? (
						<EmptyState title={t`No upcoming due dates`} />
					) : (
						<Stack>
							{weekTasks.map(task => {
								const company = companies.find(c => c.id === task.companyId)
								return (
									<TaskItem
										key={task.id}
										task={{
											id: task.id,
											title: task.title,
											dueAt: task.dueAt,
											companyId: task.companyId,
											companyName: company?.name ?? t`Company`,
											...(company?.slug !== undefined
												? { companySlug: company.slug }
												: {}),
										}}
										completed={false}
										onToggle={() => {
											void handleToggleTask(task.id)
										}}
										{...(company
											? {
													onLogInteraction: () => handleLogInteraction(company),
												}
											: {})}
									/>
								)
							})}
						</Stack>
					)}
				</Section>
			</TwoColumn>

			<Section
				initial={{ opacity: 0, y: 12 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true, amount: 0.2 }}
			>
				<SectionHeader title={t`High priority`} count={topPriorities.length} />
				{topPriorities.length === 0 ? (
					<EmptyState
						title={t`No high-priority companies without a scheduled follow-up`}
					/>
				) : (
					<CompanyGrid>
						{topPriorities.map(company => (
							<CompanyCard
								key={company.id}
								company={{
									slug: company.slug,
									name: company.name,
									status: company.status,
									industry: company.industry,
									location: company.location,
									priority: company.priority,
									lastContactedAt: company.lastContactedAt,
								}}
								actions={{
									onLogInteraction: () => handleLogInteraction(company),
								}}
							/>
						))}
					</CompanyGrid>
				)}
			</Section>
		</Page>
	)
}

const STATUS_ORDER: ReadonlyArray<CompanyStatus> = [
	'prospect',
	'contacted',
	'responded',
	'meeting',
	'proposal',
	'client',
	'closed',
	'dead',
]

const STALE_STATUSES = new Set<string>([
	'contacted',
	'responded',
	'meeting',
	'proposal',
])

function countByStatus(
	companies: ReadonlyArray<DashboardCompany>,
): Map<string, number> {
	const counts = new Map<string, number>()
	for (const company of companies) {
		counts.set(company.status, (counts.get(company.status) ?? 0) + 1)
	}
	return counts
}

function isSameDay(isoString: string, reference: number): boolean {
	const a = new Date(isoString)
	const b = new Date(reference)
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	)
}

function narrowCompanies(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<DashboardCompany> {
	const out: Array<DashboardCompany> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['slug'] !== 'string') continue
		if (typeof r['name'] !== 'string') continue
		if (typeof r['status'] !== 'string') continue
		out.push({
			id: r['id'],
			slug: r['slug'],
			name: r['name'],
			status: r['status'],
			industry: typeof r['industry'] === 'string' ? r['industry'] : null,
			location: typeof r['location'] === 'string' ? r['location'] : null,
			region: typeof r['region'] === 'string' ? r['region'] : null,
			priority: typeof r['priority'] === 'number' ? r['priority'] : null,
			lastContactedAt:
				typeof r['lastContactedAt'] === 'string' ? r['lastContactedAt'] : null,
			nextAction: typeof r['nextAction'] === 'string' ? r['nextAction'] : null,
			nextActionAt:
				typeof r['nextActionAt'] === 'string' ? r['nextActionAt'] : null,
		})
	}
	return out
}

function narrowTasks(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<DashboardTask> {
	const out: Array<DashboardTask> = []
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

const Page = styled.div.withConfig({ displayName: 'PipelinePage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-xl);
`

const Intro = styled.div.withConfig({ displayName: 'PipelineIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-sm);
`

const Title = styled.h2.withConfig({ displayName: 'PipelineTitle' })`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
`

const Subtitle = styled.p.withConfig({ displayName: 'PipelineSubtitle' })`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const KpiRow = styled.div.withConfig({ displayName: 'PipelineKpiRow' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);

	@media (min-width: 640px) {
		grid-template-columns: repeat(3, 1fr);
	}
`

const StatusStrip = styled.div.withConfig({
	displayName: 'PipelineStatusStrip',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
`

const StatusChip = styled.div.withConfig({ displayName: 'PipelineStatusChip' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const StatusCount = styled.span.withConfig({
	displayName: 'PipelineStatusCount',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-title-small-size);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`

const Section = styled(motion.section).withConfig({
	displayName: 'PipelineSection',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Stack = styled.div.withConfig({ displayName: 'PipelineStack' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const TwoColumn = styled.div.withConfig({ displayName: 'PipelineTwoColumn' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 1024px) {
		grid-template-columns: 1fr 1fr;
	}
`

const CompanyGrid = styled.div.withConfig({
	displayName: 'PipelineCompanyGrid',
})`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-sm);

	@media (min-width: 768px) {
		grid-template-columns: 1fr 1fr;
	}

	@media (min-width: 1024px) {
		grid-template-columns: 1fr 1fr 1fr;
	}

	/* Micro-rotate file cards to break grid rhythm — each card straightens
	 * on hover via whileHover={{ rotate: 0 }}. */
	& > * {
		--card-rotate: 0deg;
	}
	& > :nth-child(3n + 1) {
		--card-rotate: -0.35deg;
	}
	& > :nth-child(3n + 2) {
		--card-rotate: 0.25deg;
	}
	& > :nth-child(3n + 3) {
		--card-rotate: -0.15deg;
	}
`
