import { Effect, Schema } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import { CalendarEventAttendee } from '@batuda/domain'

const decodeAttendees = Schema.decodeUnknownEffect(
	Schema.Array(CalendarEventAttendee),
)

/**
 * Attendees for a page of events in one query, grouped in memory so a page of
 * meetings doesn't turn into a query per meeting. The organizer sorts first so
 * a caller can name who called the meeting without scanning the whole list.
 */
const attendeesByEvent = (
	sql: SqlClient.SqlClient,
	eventIds: ReadonlyArray<string>,
) =>
	Effect.gen(function* () {
		const grouped = new Map<string, Array<CalendarEventAttendee>>()
		if (eventIds.length === 0) return grouped

		// Result keys arrive camelCased whatever the column spelling, hence
		// `eventId` rather than `event_id`.
		const rows = yield* sql<{ readonly eventId: string }>`
			SELECT id, event_id, email, name, contact_id, company_id, rsvp, is_organizer
			FROM calendar_event_attendees
			WHERE event_id = ANY(${eventIds as unknown as string[]})
			ORDER BY is_organizer DESC, email ASC
		`
		// The decoded attendee carries no event of its own, so the raw row at
		// the same position supplies which meeting it belongs to.
		const decoded = yield* decodeAttendees(rows)
		for (const [index, attendee] of decoded.entries()) {
			const eventId = rows[index]!.eventId
			const bucket = grouped.get(eventId)
			if (bucket) bucket.push(attendee)
			else grouped.set(eventId, [attendee])
		}
		return grouped
	})

/** Attach each event's attendees, keyed by the event's own id. */
export const withAttendees = <E extends { readonly id: string }>(
	sql: SqlClient.SqlClient,
	events: ReadonlyArray<E>,
) =>
	attendeesByEvent(
		sql,
		events.map(event => event.id),
	).pipe(
		Effect.map(grouped =>
			events.map(event => ({
				...event,
				attendees: grouped.get(event.id) ?? [],
			})),
		),
	)
