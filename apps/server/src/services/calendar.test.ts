import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { decodeCalcomWebhookEnvelope } from './calendar'

// Pure-logic tests only. DB- and HTTP-backed branches are scaffolded
// as `it.todo(...)` until the Postgres harness lands.

describe('decodeCalcomWebhookEnvelope', () => {
	it('should accept a minimal valid envelope', () => {
		// GIVEN the smallest envelope cal.com can ship
		const input = {
			triggerEvent: 'BOOKING_CREATED',
			createdAt: '2026-04-20T10:00:00Z',
			payload: { iCalUID: 'abc@cal.com' },
		}
		// WHEN we decode it
		const result = Effect.runSync(decodeCalcomWebhookEnvelope(input))
		// THEN the typed envelope comes back with the same fields
		expect(result.triggerEvent).toBe('BOOKING_CREATED')
		expect(result.payload.iCalUID).toBe('abc@cal.com')
	})

	it('should accept a rich envelope with attendees and metadata', () => {
		// GIVEN a realistic BOOKING_CREATED payload
		const input = {
			triggerEvent: 'BOOKING_CREATED',
			createdAt: '2026-04-20T10:00:00Z',
			payload: {
				iCalUID: 'abc@cal.com',
				iCalSequence: 2,
				bookingId: 12345,
				uid: 'uid-xyz',
				eventTypeId: 999,
				title: 'Discovery',
				startTime: '2026-05-01T10:00:00Z',
				endTime: '2026-05-01T10:30:00Z',
				organizer: { email: 'me@x.com', name: 'Me' },
				attendees: [{ email: 'alice@y.com', name: 'Alice' }],
				location: 'https://meet.example/abc',
				metadata: { source: 'batuda' },
			},
		}
		// WHEN we decode
		const result = Effect.runSync(decodeCalcomWebhookEnvelope(input))
		// THEN nested shapes survive
		expect(result.payload.organizer?.email).toBe('me@x.com')
		expect(result.payload.attendees?.[0]?.name).toBe('Alice')
		expect(result.payload.metadata?.['source']).toBe('batuda')
	})

	it('should reject an envelope missing triggerEvent', () => {
		// GIVEN an envelope with no triggerEvent
		const input = { createdAt: '2026-04-20T10:00:00Z', payload: {} }
		// WHEN decoding runs THEN it fails
		const exit = Effect.runSyncExit(decodeCalcomWebhookEnvelope(input))
		expect(exit._tag).toBe('Failure')
	})

	it('should reject when triggerEvent has the wrong type', () => {
		// GIVEN a numeric triggerEvent (wrong scalar type)
		const input = {
			triggerEvent: 123,
			createdAt: '2026-04-20T10:00:00Z',
			payload: {},
		}
		// WHEN decoding runs THEN it fails
		const exit = Effect.runSyncExit(decodeCalcomWebhookEnvelope(input))
		expect(exit._tag).toBe('Failure')
	})

	it('should reject when payload is missing', () => {
		// GIVEN no payload at all
		const input = {
			triggerEvent: 'BOOKING_CREATED',
			createdAt: '2026-04-20T10:00:00Z',
		}
		// WHEN decoding runs THEN it fails
		const exit = Effect.runSyncExit(decodeCalcomWebhookEnvelope(input))
		expect(exit._tag).toBe('Failure')
	})
})

// ── DB-backed scenarios ────────────────────────────────────────────
// Promoted from .todo() once the Postgres harness is wired up.

describe('ingestIcs — METHOD=REQUEST', () => {
	it.todo(
		// GIVEN a fresh DB
		// WHEN a REQUEST arrives with iCalUID=X, SEQUENCE=0
		// THEN one calendar_events row is inserted with source=email,
		//   provider=email, ical_sequence=0, status=confirmed
		'should insert a new row with sequence 0',
	)
	it.todo(
		// GIVEN a row at (X, SEQUENCE=2)
		// WHEN a REQUEST arrives with SEQUENCE=5
		// THEN the row updates in place and start_at/end_at/title reflect the new payload
		'should upsert a newer sequence in place',
	)
	it.todo(
		// GIVEN a row at (X, SEQUENCE=5)
		// WHEN a late REQUEST arrives with SEQUENCE=3
		// THEN the stored row stays untouched (older sequence loses)
		'should ignore an older sequence arriving late',
	)
	it.todo(
		// GIVEN a REQUEST with PARTSTAT=TENTATIVE for the organizer
		// WHEN ingest runs
		// THEN status=tentative
		'should mark tentative when organizer replies tentatively',
	)
})

describe('ingestIcs — METHOD=CANCEL', () => {
	it.todo(
		// GIVEN a confirmed row at iCalUID=X
		// WHEN a CANCEL arrives for X
		// THEN the row flips to status=cancelled and a MeetingCancelled timeline row lands
		'should flip status to cancelled and record a timeline row',
	)
	it.todo(
		// GIVEN no row for X
		// WHEN a CANCEL arrives for X
		// THEN a tombstone row with status=cancelled is stored
		'should store a cancelled tombstone when no prior row exists',
	)
})

describe('ingestIcs — METHOD=REPLY', () => {
	it.todo(
		// GIVEN a confirmed row with attendee alice@x.com at rsvp=needs-action
		// WHEN a REPLY from Alice with PARTSTAT=ACCEPTED arrives
		// THEN only the attendee's rsvp becomes accepted and a MeetingRsvp timeline row is recorded
		'should update attendee RSVP in place',
	)
	it.todo(
		// GIVEN a REPLY whose ATTENDEE email is not on the stored event
		// WHEN ingest runs
		// THEN no attendee row updates and the handler logs unknown_attendee_reply
		'should ignore replies from unknown attendees',
	)
})

describe('respondToRsvp attendee guard', () => {
	it.todo(
		// GIVEN an event whose attendee list does not include bob@x.com
		// WHEN bob tries to RSVP
		// THEN the service fails with CannotRsvpForSomeoneElse
		'should reject RSVPs from non-attendees',
	)
	it.todo(
		// GIVEN a source=internal event
		// WHEN anyone tries to RSVP
		// THEN the service fails with InvalidRsvpTarget
		'should reject RSVPs on internal blocks',
	)
})

describe('forwardInvitation ICS bytes', () => {
	it.todo(
		// GIVEN a confirmed event with title "Sync w/ Marta, Joan"
		// WHEN forwardInvitation builds the ICS
		// THEN the SUMMARY line has escaped commas and a DTSTAMP property is present
		'should escape RFC 5545 text and include DTSTAMP',
	)
	it.todo(
		// GIVEN a cancelled event
		// WHEN forwardInvitation is called
		// THEN it fails with InvalidRsvpTarget (cannot_forward_cancelled_invitation)
		'should refuse forwarding cancelled invitations',
	)
})

describe('handleCalcomWebhook trigger routing', () => {
	it.todo('BOOKING_CREATED → inserts and emits MeetingScheduled')
	it.todo(
		'BOOKING_RESCHEDULED → updates existing row and emits MeetingRescheduled',
	)
	it.todo(
		'BOOKING_CANCELLED → sets status=cancelled and emits MeetingCancelled',
	)
	it.todo(
		'BOOKING_REQUESTED → inserts status=tentative, no next_calendar_event_at bump',
	)
	it.todo('BOOKING_REJECTED → flips an existing tentative to cancelled')
	it.todo('Unknown trigger → 200 OK with a log, never crashes')
})

describe('denorm-bump correctness', () => {
	it.todo('scheduling a future meeting bumps next_calendar_event_at via LEAST')
	it.todo('scheduling a past meeting bumps last_meeting_at via GREATEST')
	it.todo(
		'rescheduling the only upcoming meeting earlier moves next_calendar_event_at earlier',
	)
	it.todo(
		'cancelling the only upcoming meeting sets next_calendar_event_at to NULL',
	)
})
