/**
 * Deterministic in-memory `BookingProvider` + `IcsParser` for local dev and
 * tests. Zero network, zero cal.com account, zero `yarn dx`. Backed by a
 * `Ref` store so state survives across calls inside the same Layer.
 */

import { Effect, Layer, Ref } from 'effect'

import { BookingProvider } from '../application/ports/booking-provider'
import {
	IcsParser,
	type ParsedAttendee,
	type ParsedIcs,
	type ParsedVEvent,
} from '../application/ports/ics-parser'
import type {
	CalendarAttendeeRsvp,
	CreateBookingInput,
	FindSlotsInput,
	ProviderBookingRef,
	ProviderEventTypeRef,
	RsvpInput,
	Slot,
	UpsertEventTypeInput,
} from '../domain/calendar-event'
import { BookingFailed, InvalidIcs, NoAvailability } from '../domain/errors'

interface StubBookingRow {
	readonly providerBookingId: string
	readonly icalUid: string
	readonly icalSequence: number
	readonly providerEventTypeId: string
	readonly startAt: Date
	readonly endAt: Date
	readonly attendees: ReadonlyArray<{ email: string; name: string | null }>
	readonly cancelled: boolean
}

interface StubState {
	readonly bookings: Map<string, StubBookingRow>
	readonly eventTypes: Map<string, ProviderEventTypeRef>
	readonly nextBookingSeq: number
}

const emptyState = (): StubState => ({
	bookings: new Map(),
	eventTypes: new Map(),
	nextBookingSeq: 1,
})

const THIRTY_MINUTES_MS = 30 * 60 * 1000

/**
 * Generate deterministic 30-minute slots every hour within the window,
 * skipping weekends and times outside 09:00–18:00 local (UTC is fine for
 * stub purposes). Identical input → identical output, so tests are stable.
 */
const makeDeterministicSlots = (
	from: Date,
	to: Date,
	durationMinutes: number,
): ReadonlyArray<Slot> => {
	const slots: Slot[] = []
	const cursor = new Date(from.getTime())
	cursor.setUTCMinutes(0, 0, 0)
	const durationMs = durationMinutes * 60 * 1000
	while (cursor.getTime() + durationMs <= to.getTime()) {
		const hour = cursor.getUTCHours()
		const day = cursor.getUTCDay()
		const isWeekday = day >= 1 && day <= 5
		const isBusinessHour = hour >= 9 && hour < 18
		if (isWeekday && isBusinessHour) {
			slots.push({
				start: new Date(cursor.getTime()),
				end: new Date(cursor.getTime() + durationMs),
			})
		}
		cursor.setTime(cursor.getTime() + THIRTY_MINUTES_MS)
	}
	return slots
}

const makeIcalUid = (providerBookingId: string) =>
	`stub-${providerBookingId}@calendar.batuda`

export const makeStubBookingProvider = Effect.gen(function* () {
	const state = yield* Ref.make<StubState>(emptyState())

	const nextBookingId = Ref.modify(state, current => {
		const seq = current.nextBookingSeq
		return [`stub-bk-${seq}`, { ...current, nextBookingSeq: seq + 1 }] as const
	})

	return BookingProvider.of({
		findSlots: ({ providerEventTypeId, from, to }: FindSlotsInput) =>
			Effect.gen(function* () {
				const { eventTypes } = yield* Ref.get(state)
				const et = eventTypes.get(providerEventTypeId)
				const duration = et?.durationMinutes ?? 30
				const slots = makeDeterministicSlots(from, to, duration)
				if (slots.length === 0) {
					return yield* new NoAvailability({
						eventTypeId: providerEventTypeId,
						fromIso: from.toISOString(),
						toIso: to.toISOString(),
					})
				}
				return slots
			}),

		createBooking: ({
			providerEventTypeId,
			startAt,
			attendees,
		}: CreateBookingInput) =>
			Effect.gen(function* () {
				const providerBookingId = yield* nextBookingId
				const icalUid = makeIcalUid(providerBookingId)
				const row: StubBookingRow = {
					providerBookingId,
					icalUid,
					icalSequence: 0,
					providerEventTypeId,
					startAt,
					endAt: new Date(startAt.getTime() + THIRTY_MINUTES_MS),
					attendees: attendees.map(a => ({
						email: a.email,
						name: a.name,
					})),
					cancelled: false,
				}
				yield* Ref.update(state, current => {
					const nextBookings = new Map(current.bookings)
					nextBookings.set(providerBookingId, row)
					return { ...current, bookings: nextBookings }
				})
				return {
					provider: 'calcom',
					providerBookingId,
					icalUid,
					icalSequence: 0,
				} satisfies ProviderBookingRef
			}),

		rescheduleBooking: (providerBookingId: string, newStartAt: Date) =>
			Effect.gen(function* () {
				const { bookings } = yield* Ref.get(state)
				const existing = bookings.get(providerBookingId)
				if (!existing) {
					return yield* new BookingFailed({
						provider: 'stub',
						reason: `unknown_booking:${providerBookingId}`,
						recoverable: false,
					})
				}
				const updated: StubBookingRow = {
					...existing,
					startAt: newStartAt,
					endAt: new Date(newStartAt.getTime() + THIRTY_MINUTES_MS),
					icalSequence: existing.icalSequence + 1,
				}
				yield* Ref.update(state, current => {
					const nextBookings = new Map(current.bookings)
					nextBookings.set(providerBookingId, updated)
					return { ...current, bookings: nextBookings }
				})
				return {
					provider: 'calcom',
					providerBookingId,
					icalUid: updated.icalUid,
					icalSequence: updated.icalSequence,
				} satisfies ProviderBookingRef
			}),

		cancelBooking: (providerBookingId: string, _reason: string | null) =>
			Effect.gen(function* () {
				const { bookings } = yield* Ref.get(state)
				const existing = bookings.get(providerBookingId)
				if (!existing) {
					return yield* new BookingFailed({
						provider: 'stub',
						reason: `unknown_booking:${providerBookingId}`,
						recoverable: false,
					})
				}
				yield* Ref.update(state, current => {
					const nextBookings = new Map(current.bookings)
					nextBookings.set(providerBookingId, {
						...existing,
						cancelled: true,
						icalSequence: existing.icalSequence + 1,
					})
					return { ...current, bookings: nextBookings }
				})
			}),

		respondToRsvp: (_input: RsvpInput) =>
			// Stub treats every RSVP as a no-op; real adapter handles
			// accept/decline via POST /v2/bookings/{uid}/{accept|decline}.
			Effect.void,

		listEventTypes: () =>
			Effect.gen(function* () {
				const { eventTypes } = yield* Ref.get(state)
				return Array.from(eventTypes.values())
			}),

		upsertEventType: (input: UpsertEventTypeInput) =>
			Effect.gen(function* () {
				const ref: ProviderEventTypeRef = {
					provider: 'calcom',
					providerEventTypeId: `stub-${input.slug}`,
					slug: input.slug,
					title: input.title,
					durationMinutes: input.durationMinutes,
					locationKind: input.locationKind,
					defaultLocationValue: input.defaultLocationValue,
					active: true,
				}
				yield* Ref.update(state, current => {
					const nextTypes = new Map(current.eventTypes)
					nextTypes.set(input.slug, ref)
					return { ...current, eventTypes: nextTypes }
				})
				return ref
			}),
	})
})

export const StubBookingProviderLayer = Layer.effect(
	BookingProvider,
	makeStubBookingProvider,
)

// ── Stub IcsParser ─────────────────────────────────────────────────────────
//
// Enough shape to let upstream callers drive the calendar service in tests
// without pulling in `ical.js`. Real fixtures (Zoom/Teams/Meet) land in the
// live adapter under PR #6.

const decode = (bytes: Uint8Array): string => {
	try {
		return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
	} catch {
		return ''
	}
}

const parseMethod = (text: string): ParsedIcs['method'] => {
	const match = text.match(/^METHOD:([A-Z]+)\s*$/m)
	const value = match?.[1] ?? ''
	switch (value) {
		case 'REQUEST':
		case 'CANCEL':
		case 'REPLY':
		case 'PUBLISH':
			return value
		default:
			return 'OTHER'
	}
}

const parsePartstatToRsvp = (partstat: string): CalendarAttendeeRsvp => {
	switch (partstat.toUpperCase()) {
		case 'ACCEPTED':
			return 'accepted'
		case 'DECLINED':
			return 'declined'
		case 'TENTATIVE':
			return 'tentative'
		default:
			return 'needs-action'
	}
}

const parseIcsDate = (value: string): Date | null => {
	// Accepts both floating-time `YYYYMMDDTHHmmss` and UTC `YYYYMMDDTHHmmssZ`.
	const match = value.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/)
	if (!match) return null
	const [, y, mo, d, h, mi, s] = match
	// Fabricate ISO 8601 so the native Date parser handles UTC vs floating.
	const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${match[7] === 'Z' ? 'Z' : 'Z'}`
	const parsed = new Date(iso)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

const parseVEvent = (block: string): ParsedVEvent | null => {
	const lineOf = (name: string): string | null => {
		const re = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'm')
		const m = block.match(re)
		return m?.[1]?.trim() ?? null
	}
	const uid = lineOf('UID')
	const dtStartRaw = block.match(/^DTSTART(?:;[^:\r\n]*)?:(\S+)/m)?.[1]
	const dtEndRaw = block.match(/^DTEND(?:;[^:\r\n]*)?:(\S+)/m)?.[1]
	if (!uid || !dtStartRaw || !dtEndRaw) return null
	const startAt = parseIcsDate(dtStartRaw)
	const endAt = parseIcsDate(dtEndRaw)
	if (!startAt || !endAt) return null
	const sequenceRaw = lineOf('SEQUENCE')
	const icalSequence = sequenceRaw ? Number.parseInt(sequenceRaw, 10) : 0
	const title = lineOf('SUMMARY') ?? ''
	const organizerRaw = block.match(/^ORGANIZER(?:;[^:]*)?:(?:MAILTO:)?(\S+)/im)
	const organizerEmail = organizerRaw?.[1]?.trim().toLowerCase() ?? ''

	const attendees: ParsedAttendee[] = []
	const attendeeRe = /^ATTENDEE(?:;([^:]*))?:(?:MAILTO:)?(\S+)/gim
	let m: RegExpExecArray | null = attendeeRe.exec(block)
	while (m !== null) {
		const params = m[1] ?? ''
		const email = m[2]?.trim().toLowerCase() ?? ''
		const partstat = params.match(/PARTSTAT=([A-Z-]+)/i)?.[1] ?? 'NEEDS-ACTION'
		const cn = params.match(/CN=([^;:]+)/)?.[1] ?? null
		attendees.push({
			email,
			name: cn,
			rsvp: parsePartstatToRsvp(partstat),
			isOrganizer: email === organizerEmail,
		})
		m = attendeeRe.exec(block)
	}

	return {
		icalUid: uid,
		icalSequence,
		startAt,
		endAt,
		title,
		status: 'confirmed',
		organizerEmail,
		attendees,
		locationType: 'none',
		locationValue: null,
		videoCallUrl: null,
		metadata: {},
	}
}

export const makeStubIcsParser = Effect.succeed(
	IcsParser.of({
		parse: (raw: Uint8Array) =>
			Effect.gen(function* () {
				const text = decode(raw)
				if (!text.includes('BEGIN:VCALENDAR')) {
					return yield* new InvalidIcs({ reason: 'not-a-vcalendar' })
				}
				const method = parseMethod(text)
				const vEventBlocks = Array.from(
					text.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g),
				).map(m => m[1] ?? '')
				if (vEventBlocks.length === 0) {
					return yield* new InvalidIcs({ reason: 'no-vevent' })
				}
				const events = vEventBlocks
					.map(parseVEvent)
					.filter((e): e is ParsedVEvent => e !== null)
				if (events.length === 0) {
					return yield* new InvalidIcs({ reason: 'all-vevents-malformed' })
				}
				return { method, events }
			}),

		buildReply: ({ originalIcs, attendeeEmail, rsvp }) =>
			Effect.gen(function* () {
				const text = decode(originalIcs)
				const uidMatch = text.match(/^UID:([^\r\n]+)/m)
				if (!uidMatch) {
					return yield* new InvalidIcs({ reason: 'missing-uid' })
				}
				const uid = uidMatch[1]
				const partstat =
					rsvp === 'accepted'
						? 'ACCEPTED'
						: rsvp === 'declined'
							? 'DECLINED'
							: 'TENTATIVE'
				const reply = [
					'BEGIN:VCALENDAR',
					'VERSION:2.0',
					'METHOD:REPLY',
					'BEGIN:VEVENT',
					`UID:${uid}`,
					`ATTENDEE;PARTSTAT=${partstat}:MAILTO:${attendeeEmail}`,
					'END:VEVENT',
					'END:VCALENDAR',
					'',
				].join('\r\n')
				return new TextEncoder().encode(reply)
			}),
	}),
)

export const StubIcsParserLayer = Layer.effect(IcsParser, makeStubIcsParser)
