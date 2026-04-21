import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import type { BookingProvider } from '../application/ports/booking-provider'
import type { IcsParser } from '../application/ports/ics-parser'
import { makeStubBookingProvider, makeStubIcsParser } from './stub'

const fixturePath = (name: string) =>
	fileURLToPath(new URL(`./__fixtures__/ics/${name}`, import.meta.url))

const loadFixture = (name: string): Uint8Array =>
	new Uint8Array(readFileSync(fixturePath(name)))

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

// ── Vendor fixture coverage (Zoom / Teams / Meet) ──
//
// Each fixture reflects the actual shape the sender emits (LOCATION-vs-
// DESCRIPTION placement, line folding, X-properties). Regressions here
// mean an inbound invite lands in /calendar with `location_type='none'`
// — i.e. no join URL — so the three extractors stay pinned by data,
// not by mock strings.

describe('stub IcsParser — vendor fixtures', () => {
	it('should extract the Zoom join URL from LOCATION and populate videoCallUrl', async () => {
		// GIVEN a Zoom-sourced REQUEST where the join URL sits in LOCATION
		// AND a soft-folded DESCRIPTION repeats the same URL
		// WHEN parse runs
		// THEN videoCallUrl captures the LOCATION URL including its query string
		// AND locationType='video'
		// AND locationValue preserves the raw LOCATION text (our regex kept the `?pwd=…` tail)
		// AND metadata.video_vendor='zoom'
		const parsed = await runParser(parser =>
			parser.parse(loadFixture('zoom-invite.ics')),
		)
		expect(parsed.method).toBe('REQUEST')
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.locationType).toBe('video')
		expect(event.videoCallUrl).toMatch(
			/^https:\/\/xiroi\.zoom\.us\/j\/91234567890/,
		)
		expect(event.videoCallUrl).toContain('pwd=')
		expect(event.metadata['video_vendor']).toBe('zoom')
	})

	it('should extract the Teams join URL buried in a folded DESCRIPTION while keeping LOCATION text', async () => {
		// GIVEN a Teams REQUEST where LOCATION='Microsoft Teams Meeting' and the
		// join URL is split across folded lines in DESCRIPTION
		// WHEN parse runs
		// THEN unfoldLines stitches the URL back together before the regex runs
		// AND videoCallUrl captures the full teams.microsoft.com URL
		// AND locationValue stays 'Microsoft Teams Meeting' (human-readable)
		// AND metadata.video_vendor='teams'
		const parsed = await runParser(parser =>
			parser.parse(loadFixture('teams-invite.ics')),
		)
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.locationType).toBe('video')
		expect(event.videoCallUrl).toMatch(
			/^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//,
		)
		expect(event.locationValue).toBe('Microsoft Teams Meeting')
		expect(event.metadata['video_vendor']).toBe('teams')
	})

	it('should prefer X-GOOGLE-CONFERENCE for Meet invites and ignore losing URLs', async () => {
		// GIVEN a Google Calendar REQUEST with X-GOOGLE-CONFERENCE set AND the
		// same URL repeated in LOCATION + DESCRIPTION
		// WHEN parse runs
		// THEN videoCallUrl matches the canonical meet.google.com pattern
		// AND metadata.video_vendor='meet'
		// AND metadata.additional_video_urls stays empty (no other vendor URLs)
		const parsed = await runParser(parser =>
			parser.parse(loadFixture('meet-invite.ics')),
		)
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.locationType).toBe('video')
		expect(event.videoCallUrl).toMatch(
			/^https:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+$/,
		)
		expect(event.metadata['video_vendor']).toBe('meet')
		expect(event.metadata['additional_video_urls']).toBeUndefined()
	})

	it('should surface CANCEL as the envelope method for Outlook cancellations', async () => {
		// GIVEN an Outlook-emitted METHOD=CANCEL with the original UID
		// WHEN parse runs
		// THEN method='CANCEL' and the event's UID matches the earlier REQUEST
		// (ingestIcs relies on this UID match to flip status='cancelled' on the
		// existing row — so a UID drift here would create a tombstone instead)
		const parsed = await runParser(parser =>
			parser.parse(loadFixture('outlook-cancel.ics')),
		)
		expect(parsed.method).toBe('CANCEL')
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.icalUid).toContain('FAKE-TEAMS-UID@outlook.com')
		expect(event.icalSequence).toBe(2)
	})

	it('should surface REPLY as the envelope method and carry the replying attendee RSVP', async () => {
		// GIVEN a Google-emitted METHOD=REPLY where frank@client.example
		// accepted a previously-sent REQUEST
		// WHEN parse runs
		// THEN method='REPLY' and exactly one attendee carries PARTSTAT=ACCEPTED
		// (downstream ingestIcs updates the RSVP column for that one attendee
		// row — so the REPLY fixture deliberately has only the replying attendee)
		const parsed = await runParser(parser =>
			parser.parse(loadFixture('google-reply.ics')),
		)
		expect(parsed.method).toBe('REPLY')
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		const frank = event.attendees.find(a => a.email === 'frank@client.example')
		expect(frank?.rsvp).toBe('accepted')
	})
})

// ── Edge-case coverage for parseVEvent ──

describe('stub IcsParser — edge cases', () => {
	it('should derive endAt from DURATION when DTEND is missing', async () => {
		// GIVEN a VEVENT with DTSTART + DURATION=PT45M but no DTEND
		// WHEN parse runs
		// THEN endAt = startAt + 45 minutes (RFC 5545 §3.6.1 — DTEND and
		// DURATION are mutually exclusive; missing-both is an error, but
		// DURATION-only must be honored or we lose entire Google-style invites)
		const withDuration = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'METHOD:REQUEST',
			'BEGIN:VEVENT',
			'UID:duration-test@x.com',
			'DTSTART:20260601T090000Z',
			'DURATION:PT45M',
			'SUMMARY:Duration fallback',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n')
		const parsed = await runParser(parser =>
			parser.parse(encoded(withDuration)),
		)
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.startAt.toISOString()).toBe('2026-06-01T09:00:00.000Z')
		expect(event.endAt.getTime() - event.startAt.getTime()).toBe(45 * 60_000)
	})

	it('should flag floating-time VEVENTs in metadata.timezone', async () => {
		// GIVEN a DTSTART without a `Z` suffix (floating time per RFC 5545 §3.3.5)
		// WHEN parse runs
		// THEN the event still parses (assumed UTC) but metadata.timezone records
		// 'floating_assumed_utc' — a breadcrumb for the UI to flag ambiguous
		// timing rather than silently picking a zone
		const floating = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'METHOD:REQUEST',
			'BEGIN:VEVENT',
			'UID:floating-test@x.com',
			'DTSTART:20260601T090000',
			'DTEND:20260601T100000',
			'SUMMARY:Floating time',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n')
		const parsed = await runParser(parser => parser.parse(encoded(floating)))
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.metadata['timezone']).toBe('floating_assumed_utc')
	})

	it('should classify a tel:-prefixed LOCATION as phone and strip the prefix', async () => {
		// GIVEN a LOCATION like `tel:+34912345678` with no video URLs anywhere
		// WHEN parse runs
		// THEN locationType='phone' and locationValue drops the `tel:` prefix
		// (the UI displays raw values; the prefix is metadata, not content)
		const phone = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'METHOD:REQUEST',
			'BEGIN:VEVENT',
			'UID:phone-test@x.com',
			'DTSTART:20260601T090000Z',
			'DTEND:20260601T093000Z',
			'SUMMARY:Call with provider',
			'LOCATION:tel:+34912345678',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n')
		const parsed = await runParser(parser => parser.parse(encoded(phone)))
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.locationType).toBe('phone')
		expect(event.locationValue).toBe('+34912345678')
	})

	it('should classify a non-URL non-phone LOCATION as address', async () => {
		// GIVEN a LOCATION containing a postal address and no video URLs
		// WHEN parse runs
		// THEN locationType='address' and locationValue matches the raw address
		// (deliberately permissive — we keep the human text for review rather
		// than guess schemas)
		const address = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'METHOD:REQUEST',
			'BEGIN:VEVENT',
			'UID:address-test@x.com',
			'DTSTART:20260601T090000Z',
			'DTEND:20260601T100000Z',
			'SUMMARY:On-site visit',
			'LOCATION:Calle Mayor 23\\, 08001 Barcelona',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n')
		const parsed = await runParser(parser => parser.parse(encoded(address)))
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.locationType).toBe('address')
		expect(event.locationValue).toBe('Calle Mayor 23, 08001 Barcelona')
	})

	it('should carry extra vendor URLs into metadata.additional_video_urls on multi-vendor bodies', async () => {
		// GIVEN a DESCRIPTION that contains BOTH a Teams URL and a Zoom URL
		// (happens on forwarded threads where the second vendor's autobot also
		// injected a join link)
		// WHEN parse runs
		// THEN the first-match-wins order picks Teams (Meet > Teams > Zoom)
		// AND the Zoom URL is preserved in metadata.additional_video_urls
		// so a later UX can surface "also available via Zoom" without reparsing
		const multi = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'METHOD:REQUEST',
			'BEGIN:VEVENT',
			'UID:multi-vendor@x.com',
			'DTSTART:20260601T090000Z',
			'DTEND:20260601T100000Z',
			'SUMMARY:Hybrid meeting',
			'LOCATION:Microsoft Teams Meeting',
			'DESCRIPTION:Join via Teams https://teams.microsoft.com/l/meetup-join/abc or Zoom https://xiroi.zoom.us/j/12345',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n')
		const parsed = await runParser(parser => parser.parse(encoded(multi)))
		const event = parsed.events[0]
		if (!event) throw new Error('expected one event')
		expect(event.metadata['video_vendor']).toBe('teams')
		expect(event.metadata['additional_video_urls']).toEqual([
			expect.stringMatching(/^https:\/\/xiroi\.zoom\.us\/j\/12345/),
		])
	})
})
