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
import { styled } from 'next-yak'
import { useMemo } from 'react'

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
			locale: scheduleXLocale(i18n.locale),
			// Schedule-X draws in UTC unless told otherwise, while the event
			// dialog speaks the reader's zone; both have to use the same one.
			timezone: viewerTimeZone(),
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
		<Frame data-testid='calendar-schedule-grid'>
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

function scheduleXLocale(linguiLocale: string): string {
	switch (linguiLocale) {
		case 'en':
			return 'en-US'
		case 'ca':
			return 'ca-ES'
		default:
			return linguiLocale.includes('-') ? linguiLocale : 'en-US'
	}
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
 * The reader's own zone. The grid and the event dialog both read it, so
 * the hour on the grid matches the hour the dialog spells out.
 */
function viewerTimeZone(): string {
	return typeof Intl !== 'undefined'
		? Intl.DateTimeFormat().resolvedOptions().timeZone
		: 'UTC'
}

/**
 * Schedule-X 4.x requires Temporal.ZonedDateTime for timed events. The
 * server stores timestamptz ISO strings; the zoned value is built in the
 * same zone the grid is told to draw in.
 */
function toZonedDateTime(iso: string): Temporal.ZonedDateTime {
	return Temporal.Instant.from(iso).toZonedDateTimeISO(viewerTimeZone())
}

const Frame = styled.div`
	/*
	 * Schedule-X paints from --sx- variables fixed to light colours on :root.
	 * Pointing each at a theme token makes the header, view menu and date
	 * picker follow the app's theme; the background is opaque because those
	 * popups float over the grid with it as their fill.
	 */
	--sx-color-primary: var(--color-primary);
	--sx-color-on-primary: var(--color-on-primary);
	--sx-color-primary-container: var(--color-primary-container);
	--sx-color-on-primary-container: var(--color-on-primary-container);
	--sx-color-background: var(--color-paper-aged);
	--sx-color-on-background: var(--color-on-surface);
	--sx-color-surface: var(--color-paper-aged);
	--sx-color-surface-bright: var(--color-surface-bright);
	--sx-color-surface-dim: var(--color-surface-container-highest);
	--sx-color-surface-container: var(--color-surface-container);
	--sx-color-surface-container-low: var(--color-surface-container-low);
	--sx-color-surface-container-high: var(--color-surface-container-high);
	--sx-color-on-surface: var(--color-on-surface);
	--sx-color-outline: var(--color-outline);
	--sx-color-outline-variant: var(--color-outline-variant);
	--sx-color-neutral: var(--color-on-surface-variant);
	--sx-color-neutral-variant: var(--color-on-surface-variant);
	--sx-color-surface-tint: var(--color-primary);
	--sx-internal-color-text: var(--color-on-surface);
	--sx-internal-color-light-gray: var(--color-surface-container-high);
	--sx-internal-color-gray-ripple-background: var(--color-surface-container-highest);
	--sx-color-border: var(--color-ledger-line);
	--sx-internal-color-border: var(--color-ledger-line);
	--sx-box-shadow-level3: var(--elevation-3);

	height: 100%;
	min-height: 28rem;
	color: var(--color-on-surface);

	.sx-react-calendar-wrapper {
		height: 100%;
	}

	/* Form controls do not inherit text colour; the browser's default is black. */
	.sx__date-input {
		color: var(--color-on-surface);
	}
`
