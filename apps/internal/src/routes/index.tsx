import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { motion } from 'motion/react'
import { useCallback, useMemo } from 'react'
import styled from 'styled-components'

import {
	ATTENTION_PREVIEW,
	nextStepsAtom,
	pipelineAtom,
} from '#/atoms/pipeline-atoms'
import {
	localDayKey,
	taskCountsAtom,
	tasksShelfAtom,
} from '#/atoms/tasks-atoms'
import { SetPasswordNudge } from '#/components/profile/set-password-nudge'
import { CompanyCard } from '#/components/shared/company-card'
import { EmptyState } from '#/components/shared/empty-state'
import { KpiCounter } from '#/components/shared/kpi-counter'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { ReasonChip } from '#/components/shared/reason-chip'
import { SectionHeader } from '#/components/shared/section-header'
import {
	type CompanyStatus,
	StatusBadge,
} from '#/components/shared/status-badge'
import { TaskItem } from '#/components/shared/task-item'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { countActiveCompanies } from '#/lib/pipeline-counts'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperRow,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * A company on one of the attention lists, flattened for the card. The server
 * decides which list it belongs to; this only carries what the card draws.
 */
type AttentionCompany = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly industry: string | null
	readonly location: string | null
	readonly country: string | null
	readonly priority: number | null
	readonly lastContactedAt: string | null
	readonly nextAction: string | null
	readonly nextActionAt: string | null
}

type AttentionTask = {
	readonly id: string
	readonly title: string
	readonly dueAt: string | null
	readonly companyId: string
	readonly companyName: string
	readonly companySlug: string
}

/**
 * Server-only pipeline fetch. Dynamically imports the server client so Vite
 * excludes it from the client bundle, and reads the incoming request cookie via
 * `getRequestHeader` to forward the Better-Auth session on to the API server.
 *
 * Only the two lists that do not depend on the reader's clock are fetched here.
 * The task shelves need the edges of the reader's own day, which the browser
 * knows and the server does not, so those load on arrival.
 */
async function loadPipelineDataOnServer() {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		const [nextSteps, pipeline] = yield* Effect.all(
			[
				// These two have to match `nextStepsAtom` and `pipelineAtom` exactly:
				// the browser picks up what the server already fetched by the shape of
				// the question, so any difference means the page quietly asks again.
				client.pipeline.nextSteps({ query: { limit: ATTENTION_PREVIEW } }),
				client.pipeline.get(),
			],
			{ concurrency: 2 },
		)
		return { nextSteps, pipeline }
	})
	return Effect.runPromise(program)
}

export const Route = createFileRoute('/')({
	loader: async () => {
		if (!import.meta.env.SSR) {
			// Client-side navigation: let the atoms refetch directly via
			// `BatudaApiAtom` using the browser's session cookie. Returning an empty
			// dehydration leaves the registry alone and the component renders the
			// loading state.
			return { dehydrated: [] as const }
		}
		try {
			const { nextSteps, pipeline } = await loadPipelineDataOnServer()
			return {
				dehydrated: [
					dehydrateAtom(nextStepsAtom, AsyncResult.success(nextSteps)),
					dehydrateAtom(pipelineAtom, AsyncResult.success(pipeline)),
				] as const,
			}
		} catch (error) {
			// Expected in unauthenticated contexts (401 from SessionMiddleware) or
			// when the API is down. Fall back to empty hydration — the atoms land in
			// `Initial`, the component renders the loading state, and the
			// client-side fetch (with browser cookies) gets a second chance. See
			// server.log for the underlying cause.
			console.warn('[PipelineLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Pipeline — Batuda' }] }),
	component: PipelinePage,
})

/**
 * Module-scoped mutation atom. `Atom.family` inside `AtomHttpApi.mutation`
 * caches by the `{ group, endpoint, responseMode }` key, so pulling the atom
 * identity out here guarantees the same instance is used by every render of the
 * dashboard. `useAtomSet` wraps it into a writable setter.
 */
const completeTaskAtom = BatudaApiAtom.mutation('tasks', 'complete')

/**
 * Pipeline dashboard — answers three questions in under three seconds:
 *   1. What needs my attention right now?
 *   2. What's due today / this week?
 *   3. What does my pipeline look like?
 *
 * Every list here is decided by the server: which companies need chasing, in
 * what order, and how many there are altogether. The page used to work that out
 * in the browser from an uncounted 500-row fetch, which meant the same company
 * could land in two sections, the five shown were an arbitrary five, and the
 * number in a heading did not match the rows under it.
 */
function PipelinePage() {
	const { t } = useLingui()

	// Which day it is where the reader is. The shelves only change at midnight,
	// so keying on the day rather than the moment keeps the atom stable.
	const dayKey = localDayKey()

	const nextStepsResult = useAtomValue(nextStepsAtom)
	const pipelineResult = useAtomValue(pipelineAtom)
	const overdueTasksResult = useAtomValue(tasksShelfAtom('overdue', dayKey))
	const todayTasksResult = useAtomValue(tasksShelfAtom('today', dayKey))
	const weekTasksResult = useAtomValue(tasksShelfAtom('thisWeek', dayKey))
	const taskCountsResult = useAtomValue(taskCountsAtom(dayKey))

	const refreshNextSteps = useAtomRefresh(nextStepsAtom)
	const refreshPipeline = useAtomRefresh(pipelineAtom)
	const refreshOverdue = useAtomRefresh(tasksShelfAtom('overdue', dayKey))
	const refreshToday = useAtomRefresh(tasksShelfAtom('today', dayKey))
	const refreshWeek = useAtomRefresh(tasksShelfAtom('thisWeek', dayKey))
	const refreshCounts = useAtomRefresh(taskCountsAtom(dayKey))

	const completeTask = useAtomSet(completeTaskAtom, { mode: 'promiseExit' })
	const { open: openQuickCapture } = useQuickCapture()

	const handleToggleTask = useCallback(
		async (taskId: string) => {
			// Fire-and-forget complete — the task only toggles off-pending, so there
			// is no "next" argument. Everything that counts it has to be asked again:
			// the shelf it sat on, the shelf totals, and the company lists, whose
			// rows can inherit new next-action fields on the server side.
			await completeTask({ params: { id: taskId } })
			refreshOverdue()
			refreshToday()
			refreshWeek()
			refreshCounts()
			refreshNextSteps()
			refreshPipeline()
		},
		[
			completeTask,
			refreshCounts,
			refreshNextSteps,
			refreshOverdue,
			refreshPipeline,
			refreshToday,
			refreshWeek,
		],
	)

	const handleLogInteraction = useCallback(
		(company: { readonly id: string; readonly name: string }) => {
			openQuickCapture({ companyId: company.id, companyName: company.name })
		},
		[openQuickCapture],
	)

	const nextSteps = AsyncResult.isSuccess(nextStepsResult)
		? nextStepsResult.value
		: null
	const snapshot = AsyncResult.isSuccess(pipelineResult)
		? pipelineResult.value
		: null
	const taskCounts = AsyncResult.isSuccess(taskCountsResult)
		? taskCountsResult.value
		: null

	const overdueCompanies = useMemo(
		() => toAttentionCompanies(nextSteps?.overdueCompanies),
		[nextSteps],
	)
	const staleCompanies = useMemo(
		() => toAttentionCompanies(nextSteps?.staleCompanies),
		[nextSteps],
	)
	const highPriority = useMemo(
		() => toAttentionCompanies(nextSteps?.highPriority),
		[nextSteps],
	)
	const research = nextSteps?.researchAwaitingReview ?? []

	// The shelves come back a page at a time — far more than belongs on a summary
	// — so only the front of each is drawn. The counts beside the headings come
	// from the server and report every match, not what is on screen.
	const overdueTasks = useMemo(
		() => toAttentionTasks(overdueTasksResult).slice(0, ATTENTION_PREVIEW),
		[overdueTasksResult],
	)
	const todayTasks = useMemo(
		() => toAttentionTasks(todayTasksResult).slice(0, ATTENTION_PREVIEW),
		[todayTasksResult],
	)
	const weekTasks = useMemo(
		() => toAttentionTasks(weekTasksResult).slice(0, ATTENTION_PREVIEW),
		[weekTasksResult],
	)

	// The first paint needs the two server lists; the shelves fill in behind them
	// rather than holding the whole page on a spinner.
	const isLoading =
		AsyncResult.isInitial(nextStepsResult) ||
		AsyncResult.isInitial(pipelineResult)

	const countFor = (status: string) => snapshot?.statusCounts?.[status] ?? 0
	const activeCompanyCount = snapshot?.statusCounts
		? countActiveCompanies(snapshot.statusCounts)
		: 0

	// Every shelf but the finished one. A task sits on exactly one shelf, so
	// adding the rest up is the same question as "how many are still open" — and
	// snoozed still counts, because putting something off is not doing it.
	const openTaskCount = taskCounts
		? taskCounts.overdue +
			taskCounts.today +
			taskCounts.thisWeek +
			taskCounts.later +
			taskCounts.noDue +
			taskCounts.snoozed
		: 0

	if (isLoading) {
		return (
			<Page data-testid='pipeline-page'>
				<LoadingSpinner />
			</Page>
		)
	}

	// What the section says it holds, counting every match rather than the
	// handful fetched. The rows below are capped; these are not.
	const attentionTotal =
		(taskCounts?.overdue ?? overdueTasks.length) +
		(nextSteps?.counts.overdueCompanies ?? 0) +
		(nextSteps?.counts.staleCompanies ?? 0) +
		(nextSteps?.counts.researchAwaitingReview ?? 0)
	const attentionShown =
		overdueTasks.length +
		overdueCompanies.length +
		staleCompanies.length +
		research.length
	const attentionEmpty = attentionShown === 0

	return (
		<Page data-testid='pipeline-page'>
			<Intro>
				<Title>
					<Trans>Pipeline</Trans>
				</Title>
				<Subtitle>
					<Trans>Workshop floor — live counters on the bench.</Trans>
				</Subtitle>
			</Intro>

			<SetPasswordNudge />

			<KpiRow>
				<KpiCounter value={activeCompanyCount} label={t`Active companies`} />
				<KpiCounter value={openTaskCount} label={t`Open tasks`} />
				<KpiCounter value={taskCounts?.overdue ?? 0} label={t`Overdue`} />
				<KpiCounter
					value={snapshot?.companiesWithoutNextAction ?? 0}
					label={t`Needs action`}
				/>
			</KpiRow>

			<StatusStrip>
				{STATUS_ORDER.map(status => (
					<StatusChip key={status} data-testid={`pipeline-column-${status}`}>
						<StatusBadge status={status} size='lg' />
						<StatusCount>{countFor(status)}</StatusCount>
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
					count={attentionTotal}
					help={t`Tasks past their due date, companies whose follow-up date has passed, companies mid-deal with no contact in two weeks, and finished research nobody has decided on. Each company is listed once, under its most urgent reason. Closed and dead companies are left out.`}
				/>
				{attentionEmpty ? (
					<EmptyState
						title={t`All under control`}
						description={t`No overdue tasks, no pending follow-ups, no neglected companies.`}
					/>
				) : (
					<Stack>
						{overdueTasks.map(task => (
							<TaskItem
								key={task.id}
								task={{
									id: task.id,
									title: task.title,
									dueAt: task.dueAt,
									companyId: task.companyId,
									companyName: task.companyName,
									companySlug: task.companySlug,
								}}
								completed={false}
								overdue
								onToggle={() => {
									void handleToggleTask(task.id)
								}}
								onLogInteraction={() =>
									handleLogInteraction({
										id: task.companyId,
										name: task.companyName,
									})
								}
							/>
						))}
						{[
							...overdueCompanies.map(company => ({
								company,
								reason: 'overdue' as const,
							})),
							...staleCompanies.map(company => ({
								company,
								reason: 'stale' as const,
							})),
						].map(({ company, reason }) => (
							<AttentionRow key={company.id}>
								<ReasonChip
									reason={reason}
									since={
										reason === 'overdue'
											? company.nextActionAt
											: company.lastContactedAt
									}
								/>
								<CompanyCard
									company={{
										slug: company.slug,
										name: company.name,
										status: company.status,
										industry: company.industry,
										location: company.location,
										country: company.country,
										priority: company.priority,
										lastContactedAt: company.lastContactedAt,
									}}
									actions={{
										onLogInteraction: () => handleLogInteraction(company),
									}}
								/>
							</AttentionRow>
						))}
						{research.map(run => (
							<ResearchRow key={run.id} data-testid='pipeline-research-row'>
								<ResearchLinkOverlay>
									<Link
										to='/research/$id'
										params={{ id: run.id }}
										aria-label={run.companyName ?? run.query}
									/>
								</ResearchLinkOverlay>
								<ResearchSubject>
									{run.companyName ?? run.query}
								</ResearchSubject>
								<ResearchNote>
									{run.pendingUpdateCount > 0
										? t`${run.pendingUpdateCount} changes to review`
										: t`Research finished — needs a look`}
								</ResearchNote>
							</ResearchRow>
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
					<SectionHeader
						title={t`Today`}
						count={taskCounts?.today ?? todayTasks.length}
						help={t`Open tasks due today, in your own timezone. Anything already past its due date is under Needs attention instead.`}
					/>
					{todayTasks.length === 0 ? (
						<EmptyState title={t`No tasks for today`} />
					) : (
						<Stack>
							{todayTasks.map(task => (
								<TaskItem
									key={task.id}
									task={{
										id: task.id,
										title: task.title,
										dueAt: task.dueAt,
										companyId: task.companyId,
										companyName: task.companyName,
										companySlug: task.companySlug,
									}}
									completed={false}
									onToggle={() => {
										void handleToggleTask(task.id)
									}}
									onLogInteraction={() =>
										handleLogInteraction({
											id: task.companyId,
											name: task.companyName,
										})
									}
								/>
							))}
						</Stack>
					)}
				</Section>
				<Section
					initial={{ opacity: 0, y: 12 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, amount: 0.2 }}
				>
					<SectionHeader
						title={t`This week`}
						count={taskCounts?.thisWeek ?? weekTasks.length}
						help={t`Open tasks due in the next seven days, counted from tonight rather than to the end of the calendar week.`}
					/>
					{weekTasks.length === 0 ? (
						<EmptyState title={t`No upcoming due dates`} />
					) : (
						<Stack>
							{weekTasks.map(task => (
								<TaskItem
									key={task.id}
									task={{
										id: task.id,
										title: task.title,
										dueAt: task.dueAt,
										companyId: task.companyId,
										companyName: task.companyName,
										companySlug: task.companySlug,
									}}
									completed={false}
									onToggle={() => {
										void handleToggleTask(task.id)
									}}
									onLogInteraction={() =>
										handleLogInteraction({
											id: task.companyId,
											name: task.companyName,
										})
									}
								/>
							))}
						</Stack>
					)}
				</Section>
			</TwoColumn>

			<Section
				initial={{ opacity: 0, y: 12 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true, amount: 0.2 }}
			>
				<SectionHeader
					title={t`High priority`}
					count={nextSteps?.counts.highPriority ?? highPriority.length}
					help={t`Companies marked hot with nothing scheduled at all. One that has also gone quiet is listed above instead, so it is only asked after once.`}
				/>
				{highPriority.length === 0 ? (
					<EmptyState
						title={t`No high-priority companies without a scheduled follow-up`}
						description={t`A high-priority company that has gone quiet is listed once, under Needs attention.`}
					/>
				) : (
					<CompanyGrid>
						{highPriority.map(company => (
							<CompanyCard
								key={company.id}
								company={{
									slug: company.slug,
									name: company.name,
									status: company.status,
									industry: company.industry,
									location: company.location,
									country: company.country,
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

// Typed date fields decode to DateTime.Utc on the wire; fall back to their
// string form for anything already an ISO string.
function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

function toAttentionCompanies(
	rows: ReadonlyArray<unknown> | undefined,
): ReadonlyArray<AttentionCompany> {
	const out: Array<AttentionCompany> = []
	for (const row of rows ?? []) {
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
			country: typeof r['country'] === 'string' ? r['country'] : null,
			priority: typeof r['priority'] === 'number' ? r['priority'] : null,
			lastContactedAt: dateToIsoOrNull(r['lastContactedAt']),
			nextAction: typeof r['nextAction'] === 'string' ? r['nextAction'] : null,
			nextActionAt: dateToIsoOrNull(r['nextActionAt']),
		})
	}
	return out
}

/**
 * One shelf's rows, flattened for the row component. A task carries its company
 * through the join, so nothing here has to look one up.
 */
function toAttentionTasks(result: unknown): ReadonlyArray<AttentionTask> {
	if (!AsyncResult.isAsyncResult(result)) return []
	if (!AsyncResult.isSuccess(result)) return []
	const items = (result.value as { items?: ReadonlyArray<unknown> }).items ?? []
	const out: Array<AttentionTask> = []
	for (const row of items) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		if (typeof r['companyId'] !== 'string') continue
		out.push({
			id: r['id'],
			title: r['title'],
			dueAt: dateToIsoOrNull(r['dueAt']),
			companyId: r['companyId'],
			companyName:
				typeof r['companyName'] === 'string' ? r['companyName'] : 'Company',
			companySlug: typeof r['companySlug'] === 'string' ? r['companySlug'] : '',
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

/** A company card with the reason it earned its place sitting above it. */
const AttentionRow = styled.div.withConfig({
	displayName: 'PipelineAttentionRow',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

/**
 * A finished research run still waiting on somebody. Research takes minutes, so
 * whoever asked for it has usually moved on — this row is how a run that landed
 * unattended gets noticed at all.
 */
const ResearchRow = styled.div.withConfig({
	displayName: 'PipelineResearchRow',
})`
	${agedPaperRow}
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-sm) var(--space-md);
	border-left: 3px solid var(--color-secondary);

	&:hover {
		filter: brightness(1.04);
	}

	&:focus-within {
		box-shadow: var(--glow-active);
	}
`

// Stretched-link overlay so the whole row navigates. A `styled(Link)` would
// take the row's styling but lose the router's typing of `params`, which is
// what makes a wrong route id a compile error rather than a dead link.
const ResearchLinkOverlay = styled.div.withConfig({
	displayName: 'PipelineResearchLinkOverlay',
})`
	position: absolute;
	inset: 0;
	z-index: 0;

	a {
		display: block;
		position: absolute;
		inset: 0;
		text-indent: -9999px;
		overflow: hidden;
	}

	a:focus-visible {
		outline: none;
	}
`

const ResearchSubject = styled.span.withConfig({
	displayName: 'PipelineResearchSubject',
})`
	position: relative;
	z-index: 1;
	pointer-events: none;
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const ResearchNote = styled.span.withConfig({
	displayName: 'PipelineResearchNote',
})`
	position: relative;
	z-index: 1;
	pointer-events: none;
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
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
