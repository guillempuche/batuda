import { useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Calendar, ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import styled from 'styled-components'

import { calendarEventsByCompanyAtom } from '#/atoms/calendar-atoms'
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
	readonly attendeeCount: number
	readonly url: string | null
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
	const result = useAtomValue(
		calendarEventsByCompanyAtom({ companyId, from, limit: 3 }),
	)

	const events = useMemo<ReadonlyArray<EventRow>>(
		() => (AsyncResult.isSuccess(result) ? narrowEvents(result.value) : EMPTY),
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
								<Dot>·</Dot>
								<AttendeeCount>
									{ev.attendeeCount === 1 ? (
										<Trans>1 attendee</Trans>
									) : (
										<Trans>{ev.attendeeCount} attendees</Trans>
									)}
								</AttendeeCount>
							</Meta>
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

function narrowEvents(rows: ReadonlyArray<unknown>): ReadonlyArray<EventRow> {
	const out: Array<EventRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		if (typeof r['startAt'] !== 'string') continue
		if (typeof r['endAt'] !== 'string') continue
		const attendees = Array.isArray(r['attendees']) ? r['attendees'] : []
		const meta = (r['metadata'] ?? null) as Record<string, unknown> | null
		const url =
			typeof meta?.['cal_com_url'] === 'string'
				? (meta['cal_com_url'] as string)
				: typeof r['videoCallUrl'] === 'string'
					? (r['videoCallUrl'] as string)
					: null
		out.push({
			id: r['id'],
			title: r['title'],
			startAt: r['startAt'],
			endAt: r['endAt'],
			attendeeCount: Math.max(1, attendees.length),
			url,
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
