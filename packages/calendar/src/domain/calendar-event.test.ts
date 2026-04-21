import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	CalendarAttendeeRsvp,
	CalendarEventProvider,
	CalendarEventSource,
	CalendarEventStatus,
	CalendarLocationType,
	CalendarProvider,
} from './calendar-event'

const decodeExit = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
) => Schema.decodeUnknownExit(schema)(input)

describe('CalendarProvider', () => {
	it('should accept the four modelled backends', () => {
		// GIVEN the backends the bounded context plans to swap between
		// WHEN each is decoded independently
		// THEN all round-trip — the provider column is the swap point; losing
		// one of these literals would strand rows that already carry it
		for (const value of [
			'calcom',
			'google',
			'microsoft',
			'internal',
		] as const) {
			expect(Schema.decodeUnknownSync(CalendarProvider)(value)).toBe(value)
		}
	})

	it('should reject unknown providers like "nylas"', () => {
		// GIVEN 'nylas' (plausible future backend — would need an explicit
		// additive change, not a silent accept)
		// THEN decode fails
		const exit = decodeExit(CalendarProvider, 'nylas')
		expect(exit._tag).toBe('Failure')
	})
})

describe('CalendarEventSource', () => {
	it('should accept booking | email | internal', () => {
		// GIVEN the three WHY-it-exists categories for a calendar row
		// WHEN each is decoded
		// THEN all round-trip
		for (const value of ['booking', 'email', 'internal'] as const) {
			expect(Schema.decodeUnknownSync(CalendarEventSource)(value)).toBe(value)
		}
	})

	it('should reject a provider name leaking into the source column', () => {
		// GIVEN 'calcom' (pre-plan source value; source and provider are now
		// split so vendor swaps don't migrate rows)
		// THEN decode fails
		const exit = decodeExit(CalendarEventSource, 'calcom')
		expect(exit._tag).toBe('Failure')
	})
})

describe('CalendarEventProvider', () => {
	it('should accept every provider plus the synthetic email provider', () => {
		// GIVEN a provider column on calendar_events that also admits 'email'
		// (ICS-sourced rows have no vendor backend — they come from an inbox)
		// WHEN each is decoded
		// THEN all round-trip
		for (const value of [
			'calcom',
			'google',
			'microsoft',
			'email',
			'internal',
		] as const) {
			expect(Schema.decodeUnknownSync(CalendarEventProvider)(value)).toBe(value)
		}
	})

	it('should reject unknown providers like "outlook"', () => {
		// GIVEN 'outlook' (common-sense name but not how Microsoft's backend is
		// modelled — we use 'microsoft' to cover Bookings + Graph calendar)
		// THEN decode fails
		const exit = decodeExit(CalendarEventProvider, 'outlook')
		expect(exit._tag).toBe('Failure')
	})
})

describe('CalendarEventStatus', () => {
	it('should accept confirmed | tentative | cancelled', () => {
		// GIVEN the RFC 5545-aligned event statuses
		// WHEN each is decoded
		// THEN all round-trip
		for (const value of ['confirmed', 'tentative', 'cancelled'] as const) {
			expect(Schema.decodeUnknownSync(CalendarEventStatus)(value)).toBe(value)
		}
	})

	it('should reject a rejected literal outside the union', () => {
		// GIVEN 'rejected' (not a status; rejection of a BOOKING_REQUESTED
		// flips the row to 'cancelled' per §4 of the plan)
		// THEN decode fails
		const exit = decodeExit(CalendarEventStatus, 'rejected')
		expect(exit._tag).toBe('Failure')
	})
})

describe('CalendarLocationType', () => {
	it('should accept every location kind', () => {
		// GIVEN the five location kinds used by the attendee drawer and the
		// vendor URL extractor (§11 of the plan)
		// WHEN each is decoded
		// THEN all round-trip
		for (const value of [
			'video',
			'phone',
			'address',
			'link',
			'none',
		] as const) {
			expect(Schema.decodeUnknownSync(CalendarLocationType)(value)).toBe(value)
		}
	})

	it('should reject vendor names like "zoom" in the location column', () => {
		// GIVEN 'zoom' (the vendor URL sits in `video_call_url`, the type
		// stays 'video')
		// THEN decode fails
		const exit = decodeExit(CalendarLocationType, 'zoom')
		expect(exit._tag).toBe('Failure')
	})
})

describe('CalendarAttendeeRsvp', () => {
	it('should accept the full RFC 5545 PARTSTAT subset we model', () => {
		// GIVEN the four RSVPs the event drawer and METHOD=REPLY path write
		// WHEN each is decoded
		// THEN all round-trip
		for (const value of [
			'needs-action',
			'accepted',
			'declined',
			'tentative',
		] as const) {
			expect(Schema.decodeUnknownSync(CalendarAttendeeRsvp)(value)).toBe(value)
		}
	})

	it('should reject PARTSTAT values outside the modelled subset', () => {
		// GIVEN 'delegated' (legal RFC 5545 PARTSTAT but not part of our model;
		// accepting it would leak a state the UI has no rendering for)
		// THEN decode fails
		const exit = decodeExit(CalendarAttendeeRsvp, 'delegated')
		expect(exit._tag).toBe('Failure')
	})

	it('should reject uppercase PARTSTAT values (lowercase-only contract)', () => {
		// GIVEN 'ACCEPTED' (the RFC form; the IcsParser is expected to
		// lowercase it before it reaches this schema)
		// THEN decode fails
		const exit = decodeExit(CalendarAttendeeRsvp, 'ACCEPTED')
		expect(exit._tag).toBe('Failure')
	})
})
