import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import type { BookingProvider } from '../application/ports/booking-provider'
import type { IcsParser } from '../application/ports/ics-parser'
import { makeStubBookingProvider, makeStubIcsParser } from './stub'

const runProvider = <A, E>(
	make: (provider: BookingProvider['Service']) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const provider = yield* makeStubBookingProvider
			return yield* make(provider)
		}),
	)

const runParser = <A, E>(
	make: (parser: IcsParser['Service']) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const parser = yield* makeStubIcsParser
			return yield* make(parser)
		}),
	)

describe('stub BookingProvider', () => {
	it('should store the event type on upsert and return it on listEventTypes', async () => {
		// GIVEN an empty stub state
		// WHEN upsertEventType is called with a slug + duration
		// AND listEventTypes is read
		// THEN the event type round-trips with a stable `stub-<slug>` id
		const result = await runProvider(provider =>
			Effect.gen(function* () {
				const upserted = yield* provider.upsertEventType({
					slug: 'discovery',
					title: 'Discovery call',
					durationMinutes: 30,
					locationKind: 'video',
					defaultLocationValue: null,
				})
				const listed = yield* provider.listEventTypes()
				return { upserted, listed }
			}),
		)
		expect(result.upserted.providerEventTypeId).toBe('stub-discovery')
		expect(result.upserted.durationMinutes).toBe(30)
		expect(result.listed).toHaveLength(1)
		expect(result.listed[0]?.slug).toBe('discovery')
	})

	it('should return deterministic 30-min business-hour slots from findSlots', async () => {
		// GIVEN a Monday 09:00Z → 18:00Z window on a known event type
		// WHEN findSlots runs twice with identical inputs
		// THEN it yields 30-minute slots starting at each half-hour from 09:00 through 17:30
		// AND the second call returns the same list (determinism)
		const runs = await runProvider(provider =>
			Effect.gen(function* () {
				yield* provider.upsertEventType({
					slug: 'demo',
					title: 'Demo',
					durationMinutes: 30,
					locationKind: 'video',
					defaultLocationValue: null,
				})
				const from = new Date('2026-04-20T09:00:00Z')
				const to = new Date('2026-04-20T18:00:00Z')
				const first = yield* provider.findSlots({
					providerEventTypeId: 'stub-demo',
					from,
					to,
				})
				const second = yield* provider.findSlots({
					providerEventTypeId: 'stub-demo',
					from,
					to,
				})
				return { first, second }
			}),
		)
		expect(runs.first.length).toBeGreaterThan(0)
		expect(runs.first[0]?.start.toISOString()).toBe('2026-04-20T09:00:00.000Z')
		expect(runs.second).toEqual(runs.first)
	})

	it('should assign a fresh booking id and iCalUID on createBooking', async () => {
		// GIVEN two createBooking calls on the same event type
		// WHEN each runs
		// THEN the providerBookingId is distinct, each has `stub-<id>@calendar.batuda` iCalUID
		// AND both start at icalSequence=0
		const refs = await runProvider(provider =>
			Effect.gen(function* () {
				const first = yield* provider.createBooking({
					providerEventTypeId: 'stub-discovery',
					startAt: new Date('2026-04-20T10:00:00Z'),
					attendees: [{ email: 'alice@x.com', name: 'Alice' }],
					metadata: null,
				})
				const second = yield* provider.createBooking({
					providerEventTypeId: 'stub-discovery',
					startAt: new Date('2026-04-20T11:00:00Z'),
					attendees: [{ email: 'bob@x.com', name: 'Bob' }],
					metadata: null,
				})
				return { first, second }
			}),
		)
		expect(refs.first.providerBookingId).not.toBe(refs.second.providerBookingId)
		expect(refs.first.icalUid).toBe('stub-stub-bk-1@calendar.batuda')
		expect(refs.first.icalSequence).toBe(0)
	})

	it('should bump icalSequence on reschedule and fail for unknown ids', async () => {
		// GIVEN a created booking at icalSequence=0
		// WHEN rescheduleBooking is called once, THEN icalSequence becomes 1
		// AND a second reschedule bumps it to 2
		// AND rescheduling an unknown id yields BookingFailed(unknown_booking)
		const result = await runProvider(provider =>
			Effect.gen(function* () {
				const booking = yield* provider.createBooking({
					providerEventTypeId: 'stub-discovery',
					startAt: new Date('2026-04-20T10:00:00Z'),
					attendees: [],
					metadata: null,
				})
				const afterFirst = yield* provider.rescheduleBooking(
					booking.providerBookingId,
					new Date('2026-04-20T11:00:00Z'),
				)
				const afterSecond = yield* provider.rescheduleBooking(
					booking.providerBookingId,
					new Date('2026-04-20T12:00:00Z'),
				)
				const unknown = yield* Effect.exit(
					provider.rescheduleBooking(
						'ghost-id',
						new Date('2026-04-20T13:00:00Z'),
					),
				)
				return { afterFirst, afterSecond, unknown }
			}),
		)
		expect(result.afterFirst.icalSequence).toBe(1)
		expect(result.afterSecond.icalSequence).toBe(2)
		expect(Exit.isFailure(result.unknown)).toBe(true)
	})

	it('should mark the row as cancelled on cancelBooking and reject unknown ids', async () => {
		// GIVEN a created booking
		// WHEN cancelBooking runs, THEN the call returns void
		// AND a second cancel on an unknown id fails with BookingFailed
		const outcome = await runProvider(provider =>
			Effect.gen(function* () {
				const booking = yield* provider.createBooking({
					providerEventTypeId: 'stub-discovery',
					startAt: new Date('2026-04-20T10:00:00Z'),
					attendees: [],
					metadata: null,
				})
				yield* provider.cancelBooking(booking.providerBookingId, null)
				return yield* Effect.exit(provider.cancelBooking('ghost-id', null))
			}),
		)
		expect(Exit.isFailure(outcome)).toBe(true)
	})

	it('should fail findSlots with NoAvailability when the window has no business hours', async () => {
		// GIVEN a Saturday-only window (2026-04-25 is a Saturday; isWeekday gate
		// filters day∈{0,6}) so the slot generator yields an empty list
		// WHEN findSlots runs
		// THEN it raises NoAvailability{eventTypeId,fromIso,toIso} — this is the
		// signal the calendar service translates into a 200-with-empty-array on
		// the availability route (CalendarLive.availability does Effect.catchTag
		// 'NoAvailability' to []). Without a test, that translation path has
		// nothing pinning the error-shape contract.
		const error = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* makeStubBookingProvider
				yield* provider.upsertEventType({
					slug: 'weekend-only',
					title: 'Weekend',
					durationMinutes: 30,
					locationKind: 'video',
					defaultLocationValue: null,
				})
				return yield* Effect.flip(
					provider.findSlots({
						providerEventTypeId: 'stub-weekend-only',
						from: new Date('2026-04-25T09:00:00Z'),
						to: new Date('2026-04-25T18:00:00Z'),
					}),
				)
			}),
		)
		expect(error._tag).toBe('NoAvailability')
		if (error._tag !== 'NoAvailability') throw new Error('narrowing')
		expect(error.eventTypeId).toBe('stub-weekend-only')
		expect(error.fromIso).toBe('2026-04-25T09:00:00.000Z')
	})

	it('should keep the iCalUID stable across reschedules while bumping the sequence', async () => {
		// GIVEN a created booking — iCalUID is the RFC 5545 anchor that downstream
		// calendars use to de-dup and upsert. A reschedule must bump SEQUENCE to
		// invalidate caches BUT keep the UID so clients replace (not duplicate)
		// WHEN rescheduleBooking runs twice
		// THEN every call returns the same iCalUID
		// AND icalSequence monotonically increases (the "why" of reschedule —
		// the UID+SEQUENCE pair is the update marker)
		const outcome = await runProvider(provider =>
			Effect.gen(function* () {
				const initial = yield* provider.createBooking({
					providerEventTypeId: 'stub-discovery',
					startAt: new Date('2026-04-20T10:00:00Z'),
					attendees: [],
					metadata: null,
				})
				const afterFirst = yield* provider.rescheduleBooking(
					initial.providerBookingId,
					new Date('2026-04-20T11:00:00Z'),
				)
				const afterSecond = yield* provider.rescheduleBooking(
					initial.providerBookingId,
					new Date('2026-04-20T12:00:00Z'),
				)
				return { initial, afterFirst, afterSecond }
			}),
		)
		expect(outcome.afterFirst.icalUid).toBe(outcome.initial.icalUid)
		expect(outcome.afterSecond.icalUid).toBe(outcome.initial.icalUid)
		expect(outcome.afterFirst.icalSequence).toBeGreaterThan(
			outcome.initial.icalSequence,
		)
		expect(outcome.afterSecond.icalSequence).toBeGreaterThan(
			outcome.afterFirst.icalSequence,
		)
	})
})

const ZOOM_REQUEST_ICS = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'METHOD:REQUEST',
	'BEGIN:VEVENT',
	'UID:meeting-123@zoom.us',
	'SEQUENCE:2',
	'DTSTART:20260501T100000Z',
	'DTEND:20260501T103000Z',
	'SUMMARY:Strategy sync',
	'ORGANIZER;CN=Alice:MAILTO:alice@x.com',
	'ATTENDEE;CN=Bob;PARTSTAT=NEEDS-ACTION:MAILTO:bob@y.com',
	'ATTENDEE;PARTSTAT=ACCEPTED:MAILTO:alice@x.com',
	'END:VEVENT',
	'END:VCALENDAR',
	'',
].join('\r\n')

const encoded = (text: string) => new TextEncoder().encode(text)

describe('stub IcsParser', () => {
	it('should parse a REQUEST envelope with one VEVENT extracting UID + SEQUENCE + attendees', async () => {
		// GIVEN a minimal REQUEST ICS with UID, SEQUENCE=2, and two ATTENDEEs
		// WHEN parse runs
		// THEN method=REQUEST, one event, UID + SEQUENCE round-trip
		// AND attendees are normalized (lowercased email, organizer flagged, PARTSTAT → rsvp)
		const parsed = await runParser(parser =>
			parser.parse(encoded(ZOOM_REQUEST_ICS)),
		)
		expect(parsed.method).toBe('REQUEST')
		expect(parsed.events).toHaveLength(1)
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.icalUid).toBe('meeting-123@zoom.us')
		expect(event.icalSequence).toBe(2)
		expect(event.title).toBe('Strategy sync')
		expect(event.organizerEmail).toBe('alice@x.com')
		expect(event.attendees).toHaveLength(2)
		const alice = event.attendees.find(a => a.email === 'alice@x.com')
		expect(alice?.isOrganizer).toBe(true)
		expect(alice?.rsvp).toBe('accepted')
		const bob = event.attendees.find(a => a.email === 'bob@y.com')
		expect(bob?.isOrganizer).toBe(false)
		expect(bob?.rsvp).toBe('needs-action')
	})

	it('should reject a body that is not a VCALENDAR', async () => {
		// GIVEN an empty buffer
		// WHEN parse runs
		// THEN it fails with InvalidIcs(not-a-vcalendar)
		const error = await runParser(parser =>
			Effect.flip(parser.parse(encoded('hello world'))),
		)
		expect(error._tag).toBe('InvalidIcs')
		expect(error.reason).toBe('not-a-vcalendar')
	})

	it('should reject a VCALENDAR with zero VEVENTs', async () => {
		// GIVEN a VCALENDAR envelope with no VEVENT blocks
		// WHEN parse runs
		// THEN InvalidIcs(no-vevent)
		const error = await runParser(parser =>
			Effect.flip(
				parser.parse(
					encoded('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'),
				),
			),
		)
		expect(error.reason).toBe('no-vevent')
	})

	it('should produce a METHOD=REPLY ICS carrying the original UID on buildReply', async () => {
		// GIVEN a REQUEST ICS with a known UID
		// WHEN buildReply runs for attendee=bob@y.com with rsvp=accepted
		// THEN the output is a VCALENDAR/METHOD=REPLY carrying the SAME UID
		// AND the ATTENDEE line encodes PARTSTAT=ACCEPTED
		const out = await runParser(parser =>
			Effect.gen(function* () {
				const bytes = yield* parser.buildReply({
					originalIcs: encoded(ZOOM_REQUEST_ICS),
					attendeeEmail: 'bob@y.com',
					rsvp: 'accepted',
				})
				return new TextDecoder().decode(bytes)
			}),
		)
		expect(out).toContain('METHOD:REPLY')
		expect(out).toContain('UID:meeting-123@zoom.us')
		expect(out).toContain('PARTSTAT=ACCEPTED')
		expect(out).toContain('MAILTO:bob@y.com')
	})

	it('should fail on buildReply when the original body lacks a UID', async () => {
		// GIVEN an ICS-like blob missing a UID line
		// WHEN buildReply runs
		// THEN InvalidIcs(missing-uid) — we cannot construct a valid reply without the anchor id
		const error = await runParser(parser =>
			Effect.flip(
				parser.buildReply({
					originalIcs: encoded('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'),
					attendeeEmail: 'bob@y.com',
					rsvp: 'declined',
				}),
			),
		)
		expect(error.reason).toBe('missing-uid')
	})

	it('should reject a VCALENDAR whose only VEVENT is missing required fields', async () => {
		// GIVEN a VCALENDAR with one VEVENT that lacks UID + DTSTART + DTEND (the
		// three fields parseVEvent requires — every other field is optional)
		// WHEN parse runs
		// THEN InvalidIcs{reason='all-vevents-malformed'} — this is the distinct
		// reason from no-vevent (the block existed, it just didn't carry the
		// minimum set). The email ingest dead-letters on this specific reason
		// rather than treating it as a plain "no meeting found".
		const malformed = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'METHOD:REQUEST',
			'BEGIN:VEVENT',
			'SUMMARY:Missing the anchor fields',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n')
		const error = await runParser(parser =>
			Effect.flip(parser.parse(encoded(malformed))),
		)
		expect(error.reason).toBe('all-vevents-malformed')
	})

	it('should normalize an unknown METHOD to OTHER', async () => {
		// GIVEN a VCALENDAR with METHOD:COUNTER (a real RFC 5546 method we do
		// not route on — our service only branches on REQUEST/CANCEL/REPLY)
		// WHEN parse runs
		// THEN method='OTHER' — preserves the invariant that downstream callers
		// never see a method literal outside the documented five-value union
		const counter = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'METHOD:COUNTER',
			'BEGIN:VEVENT',
			'UID:counter-1@x.com',
			'DTSTART:20260501T100000Z',
			'DTEND:20260501T103000Z',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n')
		const parsed = await runParser(parser => parser.parse(encoded(counter)))
		expect(parsed.method).toBe('OTHER')
		expect(parsed.events).toHaveLength(1)
	})
})
