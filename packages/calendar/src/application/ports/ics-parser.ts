import { type Effect, ServiceMap } from 'effect'

import type {
	CalendarAttendeeRsvp,
	CalendarEventStatus,
	CalendarLocationType,
} from '../../domain/calendar-event'
import type { InvalidIcs } from '../../domain/errors'

export type IcsMethod = 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH' | 'OTHER'

export interface ParsedAttendee {
	readonly email: string
	readonly name: string | null
	readonly rsvp: CalendarAttendeeRsvp
	readonly isOrganizer: boolean
}

/**
 * One VEVENT extracted from a VCALENDAR payload, already normalized into
 * our domain shape. METHOD is carried on the envelope (ParsedIcs), not here.
 */
export interface ParsedVEvent {
	readonly icalUid: string
	readonly icalSequence: number
	readonly startAt: Date
	readonly endAt: Date
	readonly title: string
	readonly status: CalendarEventStatus
	readonly organizerEmail: string
	readonly attendees: ReadonlyArray<ParsedAttendee>
	readonly locationType: CalendarLocationType
	readonly locationValue: string | null
	readonly videoCallUrl: string | null
	readonly metadata: Record<string, unknown>
}

export interface ParsedIcs {
	readonly method: IcsMethod
	readonly events: ReadonlyArray<ParsedVEvent>
}

export interface BuildReplyInput {
	readonly originalIcs: Uint8Array
	readonly attendeeEmail: string
	readonly rsvp: 'accepted' | 'declined' | 'tentative'
}

/**
 * Vendor-neutral port over an RFC 5545 parser. Swappable between `ical.js`
 * and a future Effect-native implementation without touching the calendar
 * service.
 */
export class IcsParser extends ServiceMap.Service<
	IcsParser,
	{
		readonly parse: (raw: Uint8Array) => Effect.Effect<ParsedIcs, InvalidIcs>

		readonly buildReply: (
			input: BuildReplyInput,
		) => Effect.Effect<Uint8Array, InvalidIcs>
	}
>()('calendar/IcsParser') {}
