import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	BookingFailed,
	InvalidIcs,
	NoAvailability,
	UnsupportedRsvp,
} from './errors'

const decodeExit = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
) => Schema.decodeUnknownExit(schema)(input)

describe('BookingFailed', () => {
	it('should construct with the declared fields and expose the tag', () => {
		// GIVEN a provider, reason, and recoverable flag a caller would pass
		// WHEN new BookingFailed is constructed
		// THEN _tag is 'BookingFailed' (stable catch tag)
		// AND every field is accessible as a direct property
		const error = new BookingFailed({
			provider: 'calcom',
			reason: 'rate_limited',
			recoverable: true,
		})
		expect(error._tag).toBe('BookingFailed')
		expect(error.provider).toBe('calcom')
		expect(error.reason).toBe('rate_limited')
		expect(error.recoverable).toBe(true)
	})

	it('should be yieldable inside Effect.gen as a failure', async () => {
		// GIVEN a program that yields a new BookingFailed
		// WHEN runPromiseExit executes it
		// THEN the exit is a Failure carrying the same tag (proves the class
		// satisfies the YieldableError contract used across every port call)
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				return yield* new BookingFailed({
					provider: 'stub',
					reason: 'unknown_booking',
					recoverable: false,
				})
			}),
		)
		expect(exit._tag).toBe('Failure')
	})

	it('should reject inputs missing required fields', () => {
		// GIVEN an encoded payload that omits `recoverable`
		// WHEN decode runs against the class schema
		// THEN it fails — retry wrappers branch on `recoverable`, so a missing
		// value cannot be silently coerced to a default
		const exit = decodeExit(BookingFailed, {
			_tag: 'BookingFailed',
			provider: 'calcom',
			reason: 'rate_limited',
		})
		expect(exit._tag).toBe('Failure')
	})
})

describe('NoAvailability', () => {
	it('should construct with eventTypeId and ISO window strings', () => {
		// GIVEN a slot-search window the stub converts to ISO for log-friendliness
		// (see errors.ts comment — deliberate String over DateTime)
		// WHEN new NoAvailability is constructed
		// THEN every field round-trips under its declared type
		const error = new NoAvailability({
			eventTypeId: 'stub-discovery',
			fromIso: '2026-04-20T09:00:00.000Z',
			toIso: '2026-04-20T18:00:00.000Z',
		})
		expect(error._tag).toBe('NoAvailability')
		expect(error.eventTypeId).toBe('stub-discovery')
		expect(error.fromIso).toBe('2026-04-20T09:00:00.000Z')
		expect(error.toIso).toBe('2026-04-20T18:00:00.000Z')
	})

	it('should reject non-string window fields', () => {
		// GIVEN `fromIso` given as a Date rather than an ISO string
		// WHEN decode runs
		// THEN it fails — the schema pins the serialized form so logs stay flat
		const exit = decodeExit(NoAvailability, {
			_tag: 'NoAvailability',
			eventTypeId: 'x',
			fromIso: new Date(),
			toIso: '2026-04-20T18:00:00.000Z',
		})
		expect(exit._tag).toBe('Failure')
	})
})

describe('InvalidIcs', () => {
	it('should construct from a single reason string', () => {
		// GIVEN a parser reason code from the stub (e.g., 'not-a-vcalendar')
		// WHEN new InvalidIcs is constructed
		// THEN _tag is 'InvalidIcs' and reason round-trips
		const error = new InvalidIcs({ reason: 'not-a-vcalendar' })
		expect(error._tag).toBe('InvalidIcs')
		expect(error.reason).toBe('not-a-vcalendar')
	})

	it('should reject inputs missing the reason field', () => {
		// GIVEN an encoded payload with no reason
		// WHEN decode runs
		// THEN it fails — the email-reply path reads `reason` to decide whether
		// to dead-letter the message or surface a user-facing error
		const exit = decodeExit(InvalidIcs, { _tag: 'InvalidIcs' })
		expect(exit._tag).toBe('Failure')
	})
})

describe('UnsupportedRsvp', () => {
	it('should accept every modelled rsvp literal', () => {
		// GIVEN the three RSVP values supported by the RFC 5545 REPLY flow
		// (needs-action is not here — you cannot explicitly respond with it)
		// WHEN each is constructed under any provider label
		// THEN _tag is stable and rsvp round-trips
		for (const rsvp of ['accepted', 'declined', 'tentative'] as const) {
			const error = new UnsupportedRsvp({ provider: 'calcom', rsvp })
			expect(error._tag).toBe('UnsupportedRsvp')
			expect(error.rsvp).toBe(rsvp)
			expect(error.provider).toBe('calcom')
		}
	})

	it('should reject the needs-action rsvp literal at the schema boundary', () => {
		// GIVEN rsvp='needs-action' — this is the INITIAL state on an attendee,
		// never a response a caller would submit. Accepting it would silently
		// no-op an RSVP path and mask an upstream bug.
		// WHEN decode runs
		// THEN it fails
		const exit = decodeExit(UnsupportedRsvp, {
			_tag: 'UnsupportedRsvp',
			provider: 'calcom',
			rsvp: 'needs-action',
		})
		expect(exit._tag).toBe('Failure')
	})

	it('should reject rsvp values outside the three-literal union', () => {
		// GIVEN rsvp='maybe' (not a PARTSTAT we model)
		// WHEN decode runs
		// THEN it fails — callers are restricted to the union at compile time,
		// and this test guards the runtime boundary for unknown JSON inputs
		const exit = decodeExit(UnsupportedRsvp, {
			_tag: 'UnsupportedRsvp',
			provider: 'calcom',
			rsvp: 'maybe',
		})
		expect(exit._tag).toBe('Failure')
	})
})
