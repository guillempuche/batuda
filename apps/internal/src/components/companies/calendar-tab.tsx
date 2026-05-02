import { useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Calendar } from 'lucide-react'
import { useMemo } from 'react'
import styled from 'styled-components'

import { calendarEventsByCompanyAtom } from '#/atoms/calendar-atoms'
import { RelativeDate } from '#/components/shared/relative-date'
import { brushedMetalPlate } from '#/lib/workshop-mixins'

type EventRow = {
	readonly id: string
	readonly title: string
	readonly startAt: string
	readonly endAt: string
	readonly status: string
	readonly attendeeCount: number
}

const EMPTY: ReadonlyArray<EventRow> = []

export function CalendarTab({ companyId }: { readonly companyId: string }) {
	const { t } = useLingui()
	// No `from` filter — include past + future events. The endpoint's
	// `limit=50` is a safety cap; pagination is deferred until a real
	// account hits it.
	const result = useAtomValue(
		calendarEventsByCompanyAtom({ companyId, limit: 50 }),
	)

	const events = useMemo<ReadonlyArray<EventRow>>(() => {
		if (!AsyncResult.isSuccess(result)) return EMPTY
		const rows = narrowEvents(result.value)
		return [...rows].sort((a, b) => b.startAt.localeCompare(a.startAt))
	}, [result])

	if (events.length === 0) {
		return (
			<Empty data-testid='company-calendar-tab-empty'>
				<Calendar size={16} aria-hidden />
				<EmptyText>
					<Trans>No calendar events for this company yet.</Trans>
				</EmptyText>
			</Empty>
		)
	}

	return (
		<List data-testid='company-calendar-tab-list'>
			{events.map(ev => (
				<Row
					key={ev.id}
					$cancelled={ev.status === 'cancelled'}
					data-testid={`company-calendar-event-${ev.id}`}
				>
					<RowMain>
						<Title $cancelled={ev.status === 'cancelled'}>{ev.title}</Title>
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
					<StatusBadge $status={ev.status}>{ev.status}</StatusBadge>
				</Row>
			))}
		</List>
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
		if (typeof r['status'] !== 'string') continue
		const attendees = Array.isArray(r['attendees']) ? r['attendees'] : []
		out.push({
			id: r['id'],
			title: r['title'],
			startAt: r['startAt'],
			endAt: r['endAt'],
			status: r['status'],
			attendeeCount: Math.max(1, attendees.length),
		})
	}
	return out
}

const List = styled.ul`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: 0;
	padding: 0;
	margin: 0;
	border-radius: var(--shape-2xs);
	list-style: none;
`

const Row = styled.li.withConfig({
	shouldForwardProp: prop => prop !== '$cancelled',
})<{ $cancelled: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-top: 1px solid color-mix(in oklab, var(--color-on-surface) 6%, transparent);
	opacity: ${p => (p.$cancelled ? 0.65 : 1)};

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

const Title = styled.span.withConfig({
	shouldForwardProp: prop => prop !== '$cancelled',
})<{ $cancelled: boolean }>`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-decoration: ${p => (p.$cancelled ? 'line-through' : 'none')};
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

const StatusBadge = styled.span.withConfig({
	shouldForwardProp: prop => prop !== '$status',
})<{ $status: string }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	background: ${p =>
		p.$status === 'cancelled'
			? 'color-mix(in oklab, var(--color-error, #c6664b) 60%, white)'
			: p.$status === 'tentative'
				? 'color-mix(in oklab, var(--color-on-surface) 24%, transparent)'
				: 'color-mix(in oklab, var(--color-primary) 50%, white)'};
	color: var(--color-on-primary);
`

const Empty = styled.div`
	display: inline-flex;
	gap: var(--space-2xs);
	align-items: center;
	color: var(--color-on-surface-variant);
	padding: var(--space-md) 0;
`

const EmptyText = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	margin: 0;
`
