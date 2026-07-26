import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Calendar, ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import styled from 'styled-components'

import { calendarEventsByCompanyAtom } from '#/atoms/calendar-atoms'
import { ErrorState } from '#/components/shared/error-state'
import { RelativeDate } from '#/components/shared/relative-date'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type EventRow = {
	readonly id: string
	readonly title: string
	readonly startAt: string
	readonly endAt: string
	readonly attendees: ReadonlyArray<AttendeeRow>
	readonly url: string | null
	// What the invitation itself says the meeting is about.
	readonly agenda: string | null
}

type AttendeeRow = {
	readonly id: string
	readonly label: string
	readonly rsvp: string
	readonly isOrganizer: boolean
	// False when the address matches no contact on file — the person you most
	// need to read up on before the meeting.
	readonly isKnown: boolean
}

const EMPTY: ReadonlyArray<EventRow> = []

export function UpcomingMeetingsCard({
	companyId,
}: {
	readonly companyId: string
}) {
	const { t } = useLingui()
	// Filter from "now" — the server's `from` accepts ISO. Using a stable
	// string key per minute would re-fetch every minute; instead we accept
	// that an event whose start crossed `now` since the page loaded will
	// linger until the next reload. Acceptable for a lightweight card.
	const from = useMemo(() => new Date().toISOString().slice(0, 10), [])
	const eventsAtom = useMemo(
		() => calendarEventsByCompanyAtom({ companyId, from, limit: 3 }),
		[companyId, from],
	)
	const result = useAtomValue(eventsAtom)
	const refresh = useAtomRefresh(eventsAtom)

	const events = useMemo<ReadonlyArray<EventRow>>(
		() =>
			AsyncResult.isSuccess(result) ? narrowEvents(result.value.items) : EMPTY,
		[result],
	)

	if (AsyncResult.isWaiting(result) && events.length === 0) {
		return (
			<Panel data-testid='company-upcoming-meetings-card'>
				<Header>
					<Heading>
						<Calendar size={14} aria-hidden />
						<Trans>Upcoming meetings</Trans>
					</Heading>
				</Header>
				<Loading>
					<Trans>Loading…</Trans>
				</Loading>
			</Panel>
		)
	}

	// Saying "no upcoming meetings" when the request failed tells someone
	// preparing for a meeting that there isn't one.
	if (AsyncResult.isFailure(result)) {
		return (
			<Panel data-testid='company-upcoming-meetings-card'>
				<Header>
					<Heading>
						<Calendar size={14} aria-hidden />
						<Trans>Upcoming meetings</Trans>
					</Heading>
				</Header>
				<ErrorState
					data-testid='company-upcoming-meetings-error'
					variant='inline'
					title={t`Could not load meetings`}
					description={t`This is not the same as having none. Try again to see what is scheduled.`}
					onRetry={refresh}
				/>
			</Panel>
		)
	}

	if (events.length === 0) {
		return (
			<Panel data-testid='company-upcoming-meetings-card'>
				<Header>
					<Heading>
						<Calendar size={14} aria-hidden />
						<Trans>Upcoming meetings</Trans>
					</Heading>
				</Header>
				<Empty>
					<Trans>No upcoming meetings.</Trans>
				</Empty>
			</Panel>
		)
	}

	return (
		<Panel data-testid='company-upcoming-meetings-card'>
			<Header>
				<Heading>
					<Calendar size={14} aria-hidden />
					<Trans>Upcoming meetings</Trans>
				</Heading>
			</Header>
			<List>
				{events.map(ev => (
					<Row key={ev.id} data-testid={`company-upcoming-meeting-${ev.id}`}>
						<RowMain>
							<Title>{ev.title}</Title>
							<Meta>
								<RelativeDate value={ev.startAt} fallback={t`unknown`} />
								{ev.attendees.length > 0 ? (
									<>
										<Dot>·</Dot>
										<AttendeeCount>
											{ev.attendees.length === 1 ? (
												<Trans>1 attendee</Trans>
											) : (
												<Trans>{ev.attendees.length} attendees</Trans>
											)}
										</AttendeeCount>
									</>
								) : null}
							</Meta>
							{ev.attendees.length > 0 ? (
								<Attendees>
									{ev.attendees.map(person => (
										<Attendee
											key={person.id}
											$known={person.isKnown}
											title={
												person.isKnown
													? undefined
													: t`Not a contact on file yet`
											}
										>
											{person.label}
											{person.isOrganizer ? (
												<AttendeeNote>
													<Trans>organizer</Trans>
												</AttendeeNote>
											) : null}
											{person.rsvp === 'declined' ? (
												<AttendeeNote>
													<Trans>declined</Trans>
												</AttendeeNote>
											) : person.rsvp === 'tentative' ? (
												<AttendeeNote>
													<Trans>tentative</Trans>
												</AttendeeNote>
											) : null}
										</Attendee>
									))}
								</Attendees>
							) : null}
							{ev.agenda !== null ? (
								<Agenda
									data-testid={`company-upcoming-meeting-agenda-${ev.id}`}
								>
									{ev.agenda}
								</Agenda>
							) : null}
						</RowMain>
						{ev.url !== null ? (
							<OpenLink href={ev.url} target='_blank' rel='noreferrer'>
								<ExternalLink size={12} aria-hidden />
								<span>
									<Trans>Open in Cal.com</Trans>
								</span>
							</OpenLink>
						) : null}
					</Row>
				))}
			</List>
		</Panel>
	)
}

// Typed date fields decode to DateTime.Utc on the wire; fall back to their
// string form for anything already an ISO string.
function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

function narrowAttendees(value: unknown): ReadonlyArray<AttendeeRow> {
	if (!Array.isArray(value)) return []
	const out: Array<AttendeeRow> = []
	for (const row of value) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const email = typeof r['email'] === 'string' ? r['email'] : null
		if (email === null) continue
		const name = typeof r['name'] === 'string' ? r['name'].trim() : ''
		out.push({
			id: typeof r['id'] === 'string' ? r['id'] : email,
			label: name.length > 0 ? name : email,
			rsvp: typeof r['rsvp'] === 'string' ? r['rsvp'] : 'needs-action',
			isOrganizer: r['isOrganizer'] === true,
			isKnown: typeof r['contactId'] === 'string',
		})
	}
	return out
}

function narrowEvents(rows: ReadonlyArray<unknown>): ReadonlyArray<EventRow> {
	const out: Array<EventRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		const startAt = dateToIsoOrNull(r['startAt'])
		if (startAt === null) continue
		const endAt = dateToIsoOrNull(r['endAt'])
		if (endAt === null) continue
		// A meeting that was called off is not upcoming. The Conversations tab
		// keeps it, because what was cancelled is part of the account's history.
		if (r['status'] === 'cancelled') continue
		const meta = (r['metadata'] ?? null) as Record<string, unknown> | null
		const url =
			typeof meta?.['cal_com_url'] === 'string'
				? (meta['cal_com_url'] as string)
				: typeof r['videoCallUrl'] === 'string'
					? (r['videoCallUrl'] as string)
					: null
		const description = meta?.['description']
		out.push({
			id: r['id'],
			title: r['title'],
			startAt,
			endAt,
			attendees: narrowAttendees(r['attendees']),
			url,
			agenda:
				typeof description === 'string' && description.trim() !== ''
					? description
					: null,
		})
	}
	return out
}

const Panel = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const Header = styled.header`
	${rulerUnderRule}
	padding-bottom: var(--space-2xs);
`

const Heading = styled.h3`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	margin: 0;
	padding: 0;
	list-style: none;
`

const Row = styled.li`
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-2xs) 0;
	border-top: 1px solid color-mix(in oklab, var(--color-on-surface) 6%, transparent);

	&:first-child {
		border-top: none;
	}
`

const RowMain = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const Title = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Meta = styled.span`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Dot = styled.span`
	color: var(--color-on-surface-variant);
`

const AttendeeCount = styled.span`
	font-variant-numeric: tabular-nums;
`

const Attendees = styled.ul`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	margin: var(--space-3xs) 0 0;
	padding: 0;
	list-style: none;
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
`

// An attendee we hold no contact for is dashed rather than solid: it reads as
// provisional, and it is the cue to look them up before the meeting.
const Attendee = styled.li<{ readonly $known: boolean }>`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-3xs);
	padding: 0 var(--space-2xs);
	border-radius: var(--shape-3xs);
	border: 1px ${p => (p.$known ? 'solid' : 'dashed')}
		var(--color-outline-variant);
	color: ${p =>
		p.$known ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)'};
`

const AttendeeNote = styled.span`
	font-size: 0.85em;
	color: var(--color-on-surface-variant);
`

// Invitation descriptions run long and often repeat the joining details, so only
// the first few lines show rather than pushing the next meeting off the card.
const Agenda = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	white-space: pre-wrap;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
`

const OpenLink = styled.a`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-primary);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
`

const Empty = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Loading = styled.p`
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`
