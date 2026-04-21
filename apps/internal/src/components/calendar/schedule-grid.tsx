import '@schedule-x/theme-default/dist/calendar.css'
import 'temporal-polyfill/global'

import { useLingui } from '@lingui/react/macro'
import {
	createViewDay,
	createViewMonthAgenda,
	createViewMonthGrid,
	createViewWeek,
	createViewWeekAgenda,
} from '@schedule-x/calendar'
import { createCurrentTimePlugin } from '@schedule-x/current-time'
import { createDragAndDropPlugin } from '@schedule-x/drag-and-drop'
import { createEventModalPlugin } from '@schedule-x/event-modal'
import { createEventsServicePlugin } from '@schedule-x/events-service'
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react'
import { createResizePlugin } from '@schedule-x/resize'
import { useMemo } from 'react'
import styled from 'styled-components'

/**
 * Schedule-X wrapper. Rendered inside a `React.lazy()` boundary from
 * `routes/calendar/index.tsx` so the Temporal polyfill + Schedule-X
 * bundle never ship with the SSR pass.
 *
 * The bundled theme (`theme-default/calendar.css`) provides sane
 * defaults; we layer workshop-palette overrides via the wrapper's
 * CSS-variable scope so the grid adopts the pegboard look without
 * forking the upstream stylesheet.
 */

export type ScheduleGridEvent = {
	readonly id: string
	readonly title: string
	readonly source: 'booking' | 'email' | 'internal'
	readonly status: 'confirmed' | 'tentative' | 'cancelled'
	readonly startAt: string
	readonly endAt: string
}

type Props = {
	readonly events: ReadonlyArray<ScheduleGridEvent>
	readonly onEventClick: (eventId: string) => void
}

export default function ScheduleGrid({ events, onEventClick }: Props) {
	const { i18n } = useLingui()

	const calendarEvents = useMemo(() => events.map(toScheduleXEvent), [events])

	// Plugins must be memoised so `useCalendarApp` doesn't tear down the
	// plugin ref on every render — tearing down drag-and-drop mid-drag
	// dispatches stale pointer events into a dead tree.
	const plugins = useMemo(
		() => [
			createEventsServicePlugin(),
			createDragAndDropPlugin(),
			createResizePlugin(),
			createEventModalPlugin(),
			createCurrentTimePlugin(),
		],
		[],
	)

	const calendarApp = useCalendarApp(
		{
			views: [
				createViewMonthAgenda(),
				createViewWeekAgenda(),
				createViewWeek(),
				createViewDay(),
				createViewMonthGrid(),
			],
			defaultView: pickDefaultView(),
			locale: i18n.locale,
			events: calendarEvents,
			calendars: CALENDAR_PALETTE,
			callbacks: {
				onEventClick: event => {
					const id = typeof event.id === 'string' ? event.id : String(event.id)
					onEventClick(id)
				},
			},
		},
		plugins,
	)

	return (
		<Frame>
			<ScheduleXCalendar calendarApp={calendarApp} />
		</Frame>
	)
}

/**
 * Plan §6: source colours (booking=blue, email=gray, internal=green).
 * Schedule-X expects a `calendars` map keyed by a short id that events
 * reference via `calendarId`. The light/dark variants are placeholders
 * that match workshop palette tokens — fine-tune once the grid renders.
 */
const CALENDAR_PALETTE = {
	booking: {
		colorName: 'booking',
		lightColors: {
			main: '#2e6db4',
			container: '#d4e4fb',
			onContainer: '#0d2a4f',
		},
		darkColors: {
			main: '#89b4f1',
			container: '#1a3766',
			onContainer: '#d8e7fc',
		},
	},
	email: {
		colorName: 'email',
		lightColors: {
			main: '#6b7280',
			container: '#e5e7eb',
			onContainer: '#1f2937',
		},
		darkColors: {
			main: '#cbd5e1',
			container: '#374151',
			onContainer: '#e5e7eb',
		},
	},
	internal: {
		colorName: 'internal',
		lightColors: {
			main: '#2f7a4a',
			container: '#d7ead8',
			onContainer: '#143220',
		},
		darkColors: {
			main: '#8ccd9e',
			container: '#1e4a30',
			onContainer: '#d9f0e0',
		},
	},
} as const

function pickDefaultView(): string {
	if (typeof window === 'undefined') return 'week'
	if (window.matchMedia('(min-width: 1200px)').matches) return 'week'
	if (window.matchMedia('(min-width: 768px)').matches) return 'week-agenda'
	return 'month-agenda'
}

function toScheduleXEvent(event: ScheduleGridEvent): {
	id: string
	title: string
	start: Temporal.ZonedDateTime
	end: Temporal.ZonedDateTime
	calendarId: string
} {
	return {
		id: event.id,
		title: event.title,
		start: toZonedDateTime(event.startAt),
		end: toZonedDateTime(event.endAt),
		calendarId: event.source,
	}
}

/**
 * Schedule-X 4.x requires Temporal.ZonedDateTime for timed events. The
 * server stores timestamptz ISO strings; we build the zoned value using
 * the runtime's IANA timezone so the grid renders in the viewer's
 * local wall-clock without tampering with the stored instant.
 */
function toZonedDateTime(iso: string): Temporal.ZonedDateTime {
	const tz =
		typeof Intl !== 'undefined'
			? Intl.DateTimeFormat().resolvedOptions().timeZone
			: 'UTC'
	return Temporal.Instant.from(iso).toZonedDateTimeISO(tz)
}

const Frame = styled.div.withConfig({ displayName: 'ScheduleGridFrame' })`
	/*
	 * Schedule-X reads its palette from CSS custom properties prefixed
	 * with --sx-. Overriding them inside the wrapper keeps the workshop
	 * look localised to the /calendar route without monkey-patching the
	 * vendor stylesheet.
	 */
	--sx-color-primary: var(--color-primary);
	--sx-color-on-primary: var(--color-on-primary);
	--sx-color-background: transparent;
	--sx-color-surface: var(--color-paper-aged);
	--sx-color-on-surface: var(--color-on-surface);
	--sx-color-border: var(--color-ledger-line);
	--sx-internal-color-border: var(--color-ledger-line);

	height: 100%;
	min-height: 28rem;

	.sx-react-calendar-wrapper {
		height: 100%;
	}
`
