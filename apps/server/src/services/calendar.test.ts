import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { decodeCalcomWebhookEnvelope } from './calendar'

// Pure-logic tests only. DB- and HTTP-backed branches live in their own
// slice — write a regression test when a real user reports a bug.

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

// DB-backed calendar scenarios (ICS ingest, RSVP guards, cal.com webhook
// routing, denorm-bump correctness) live outside this file. The calendar
// multi-org slice is its own plan; cover those branches when a real bug
// surfaces or when the calendar slice lands its own integration tests.
