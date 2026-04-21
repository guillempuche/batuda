import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { CalendarPlus } from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog } from '@batuda/ui/pri'

import {
	calendarEventsAtom,
	calendarEventTypesAtom,
} from '#/atoms/calendar-atoms'
import { companiesListAtom } from '#/atoms/pipeline-atoms'
import { createTaskAtom } from '#/atoms/tasks-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperSurface,
	brushedMetalPlate,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Mobile-first calendar surface (plan §6). Schedule-X is client-only
 * because it pulls Temporal polyfills and Preact signals that break SSR
 * — we render a skeleton during hydration and swap the interactive grid
 * in via a dynamic import. The server loader still fetches the event
 * list so SEO + first-paint text are meaningful.
 */
type CalendarEventRow = {
	readonly id: string
	readonly title: string
	readonly source: 'booking' | 'email' | 'internal'
	readonly status: 'confirmed' | 'tentative' | 'cancelled'
	readonly startAt: string
	readonly endAt: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly locationType: 'video' | 'phone' | 'address' | 'link' | 'none'
	readonly locationValue: string | null
	readonly videoCallUrl: string | null
	readonly organizerEmail: string
}

type CompanyLookup = {
	readonly id: string
	readonly slug: string
	readonly name: string
}

const ScheduleGrid = lazy(() => import('#/components/calendar/schedule-grid'))

async function loadCalendarOnServer(): Promise<{
	events: ReadonlyArray<unknown>
	eventTypes: ReadonlyArray<unknown>
	companies: ReadonlyArray<unknown>
}> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		const [events, eventTypes, companies] = yield* Effect.all(
			[
				client.calendar.listEvents({ query: { limit: 500 } }),
				client.calendar.listEventTypes({ query: { active: 'true' } }),
				client.companies.list({ query: { limit: 500 } }),
			],
			{ concurrency: 3 },
		)
		return { events, eventTypes, companies }
	})
	return Effect.runPromise(program)
}

export const Route = createFileRoute('/calendar/')({
	loader: async () => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const { events, eventTypes, companies } = await loadCalendarOnServer()
			return {
				dehydrated: [
					dehydrateAtom(calendarEventsAtom, AsyncResult.success(events)),
					dehydrateAtom(
						calendarEventTypesAtom,
						AsyncResult.success(eventTypes),
					),
					dehydrateAtom(companiesListAtom, AsyncResult.success(companies)),
				] as const,
			}
		} catch (error) {
			console.warn('[CalendarLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	component: CalendarPage,
})

function CalendarPage() {
	const { t } = useLingui()
	const eventsResult = useAtomValue(calendarEventsAtom)
	const companiesResult = useAtomValue(companiesListAtom)
	const createTask = useAtomSet(createTaskAtom)

	const events = useMemo<ReadonlyArray<CalendarEventRow>>(() => {
		if (!AsyncResult.isSuccess(eventsResult)) return []
		return (eventsResult.value as ReadonlyArray<unknown>).map(toEventRow)
	}, [eventsResult])

	const companies = useMemo<ReadonlyArray<CompanyLookup>>(() => {
		if (!AsyncResult.isSuccess(companiesResult)) return []
		return (companiesResult.value as ReadonlyArray<unknown>)
			.map(toCompanyLookup)
			.filter((c): c is CompanyLookup => c !== null)
	}, [companiesResult])

	const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
	const selectedEvent = useMemo(
		() => events.find(e => e.id === selectedEventId) ?? null,
		[events, selectedEventId],
	)

	const handleCreateFollowUp = useCallback(
		(event: CalendarEventRow) => {
			const end = new Date(event.endAt)
			const companyIdProps =
				event.companyId !== null ? { companyId: event.companyId } : {}
			createTask({
				payload: {
					type: 'followup',
					title: `Follow up: ${event.title}`,
					dueAt: DateTime.fromDateUnsafe(end),
					priority: 'normal',
					...companyIdProps,
				},
			})
			setSelectedEventId(null)
		},
		[createTask],
	)

	const loading = AsyncResult.isWaiting(eventsResult)
	const empty = !loading && events.length === 0

	return (
		<Page>
			<Header>
				<HeaderTitle>
					<Trans>Calendar</Trans>
				</HeaderTitle>
				<HeaderSub>
					<Trans>
						Meetings from bookings, email invitations, and internal blocks.
					</Trans>
				</HeaderSub>
			</Header>

			<GridFrame>
				{loading && events.length === 0 ? (
					<LoadingSpinner label={t`Loading calendar…`} />
				) : empty ? (
					<EmptyState
						title={t`No calendar events yet`}
						description={t`Book a meeting from a company page or forward an invitation to your inbox to see it here.`}
					/>
				) : (
					<Suspense
						fallback={<LoadingSpinner label={t`Preparing calendar view…`} />}
					>
						<ScheduleGrid
							events={events}
							onEventClick={id => setSelectedEventId(id)}
						/>
					</Suspense>
				)}
			</GridFrame>

			{selectedEvent !== null ? (
				<EventDetailDialog
					event={selectedEvent}
					company={
						selectedEvent.companyId !== null
							? (companies.find(c => c.id === selectedEvent.companyId) ?? null)
							: null
					}
					onClose={() => setSelectedEventId(null)}
					onCreateFollowUp={() => handleCreateFollowUp(selectedEvent)}
				/>
			) : null}
		</Page>
	)
}

// ── Event detail dialog ────────────────────────────────────────────

function EventDetailDialog({
	event,
	company,
	onClose,
	onCreateFollowUp,
}: {
	event: CalendarEventRow
	company: CompanyLookup | null
	onClose: () => void
	onCreateFollowUp: () => void
}) {
	const { t } = useLingui()
	const start = new Date(event.startAt)
	const end = new Date(event.endAt)

	return (
		<PriDialog.Root open onOpenChange={open => !open && onClose()}>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup>
					<PriDialog.Title>{event.title}</PriDialog.Title>
					<PriDialog.Description>
						{company !== null ? company.name : t`Personal`}
					</PriDialog.Description>

					<DetailMeta>
						<DetailField>
							<DetailLabel>
								<Trans>When</Trans>
							</DetailLabel>
							<DetailValue>
								{start.toLocaleString('en', {
									dateStyle: 'medium',
									timeStyle: 'short',
								})}
								{' – '}
								{end.toLocaleTimeString('en', { timeStyle: 'short' })}
							</DetailValue>
						</DetailField>
						<DetailField>
							<DetailLabel>
								<Trans>Source</Trans>
							</DetailLabel>
							<DetailValue>{event.source}</DetailValue>
						</DetailField>
						<DetailField>
							<DetailLabel>
								<Trans>Status</Trans>
							</DetailLabel>
							<DetailValue>{event.status}</DetailValue>
						</DetailField>
						<DetailField>
							<DetailLabel>
								<Trans>Location</Trans>
							</DetailLabel>
							<DetailValue>
								{event.videoCallUrl !== null ? (
									<VideoLink
										href={event.videoCallUrl}
										target='_blank'
										rel='noreferrer'
									>
										<Trans>Join video call</Trans>
									</VideoLink>
								) : event.locationValue !== null ? (
									event.locationValue
								) : (
									t`no location`
								)}
							</DetailValue>
						</DetailField>
					</DetailMeta>

					<ActionRow>
						<PriButton onClick={onCreateFollowUp}>
							<CalendarPlus size={12} aria-hidden />
							<Trans>Create follow-up task</Trans>
						</PriButton>
						{company !== null ? (
							<PriButton
								$variant='text'
								onClick={() => {
									window.location.assign(`/companies/${company.slug}`)
								}}
							>
								<Trans>Open company</Trans>
							</PriButton>
						) : null}
						<PriButton $variant='text' onClick={onClose}>
							<Trans>Close</Trans>
						</PriButton>
					</ActionRow>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

// ── Row → domain adapters ──────────────────────────────────────────

function toEventRow(raw: unknown): CalendarEventRow {
	const r = raw as Record<string, unknown>
	return {
		id: String(r['id'] ?? ''),
		title: String(r['title'] ?? ''),
		source: (r['source'] as CalendarEventRow['source']) ?? 'internal',
		status: (r['status'] as CalendarEventRow['status']) ?? 'confirmed',
		startAt: String(r['start_at'] ?? r['startAt'] ?? ''),
		endAt: String(r['end_at'] ?? r['endAt'] ?? ''),
		companyId: (r['company_id'] ?? r['companyId'] ?? null) as string | null,
		contactId: (r['contact_id'] ?? r['contactId'] ?? null) as string | null,
		locationType: (r['location_type'] ??
			r['locationType']) as CalendarEventRow['locationType'],
		locationValue: (r['location_value'] ?? r['locationValue'] ?? null) as
			| string
			| null,
		videoCallUrl: (r['video_call_url'] ?? r['videoCallUrl'] ?? null) as
			| string
			| null,
		organizerEmail: String(r['organizer_email'] ?? r['organizerEmail'] ?? ''),
	}
}

function toCompanyLookup(raw: unknown): CompanyLookup | null {
	const r = raw as Record<string, unknown>
	const id = r['id']
	const slug = r['slug']
	const name = r['name']
	if (
		typeof id !== 'string' ||
		typeof slug !== 'string' ||
		typeof name !== 'string'
	)
		return null
	return { id, slug, name }
}

// ── Styled ─────────────────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'CalendarPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	min-height: 100dvh;
`

const Header = styled.header.withConfig({ displayName: 'CalendarHeader' })`
	${brushedMetalPlate}
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-md);
`

const HeaderTitle = styled.h1.withConfig({
	displayName: 'CalendarHeaderTitle',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	color: var(--color-on-metal);
	margin: 0;
`

const HeaderSub = styled.p.withConfig({ displayName: 'CalendarHeaderSub' })`
	margin: var(--space-3xs) 0 0;
	color: var(--color-on-metal-muted);
	font-size: var(--typescale-body-small-size);
`

const GridFrame = styled.div.withConfig({ displayName: 'CalendarGridFrame' })`
	${agedPaperSurface}
	border-radius: var(--shape-md);
	padding: var(--space-sm);
	flex: 1;
	min-height: 32rem;

	@media (min-width: 768px) {
		padding: var(--space-md);
	}
`

const DetailMeta = styled.dl.withConfig({ displayName: 'CalendarDetailMeta' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-sm);
	margin: var(--space-md) 0;

	@media (min-width: 640px) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
`

const DetailField = styled.div.withConfig({
	displayName: 'CalendarDetailField',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const DetailLabel = styled.dt.withConfig({
	displayName: 'CalendarDetailLabel',
})`
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-muted);
	text-transform: uppercase;
	letter-spacing: 0.08em;
`

const DetailValue = styled.dd.withConfig({
	displayName: 'CalendarDetailValue',
})`
	margin: 0;
	color: var(--color-on-surface);
	font-size: var(--typescale-body-medium-size);
`

const VideoLink = styled.a.withConfig({ displayName: 'CalendarVideoLink' })`
	color: var(--color-primary);
	text-decoration: underline;
`

const ActionRow = styled.div.withConfig({ displayName: 'CalendarActionRow' })`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	margin-top: var(--space-md);
`
