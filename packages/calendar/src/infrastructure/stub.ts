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

// ── IcsParser — RFC 5545 subset ────────────────────────────────────────────
//
// Zero-dep parser sized for the shapes we actually receive from Zoom / Teams /
// Meet / Outlook / Google Calendar invites. RRULE expansion is intentionally
// left to downstream (master-instance upsert only); anything beyond that —
// VTIMEZONE definitions, VTODO, floating-time conversion — degrades into a
// `metadata.*` breadcrumb rather than a hard failure so one odd sender
// doesn't block the inbound-email path.

const decode = (bytes: Uint8Array): string => {
	try {
		return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
	} catch {
		return ''
	}
}

// RFC 5545 §3.1: a CRLF followed by whitespace is a soft line break used to
// keep long values under the 75-octet limit. Unfold before matching so LOCATION
// and DESCRIPTION lines (which routinely wrap) survive our regex-based parse.
const unfoldLines = (text: string): string =>
	text.replace(/\r\n[\t ]/g, '').replace(/\n[\t ]/g, '')

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

const parseIcsDate = (
	value: string,
): { date: Date; floating: boolean } | null => {
	// Accepts both floating-time `YYYYMMDDTHHmmss` and UTC `YYYYMMDDTHHmmssZ`.
	const match = value.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/)
	if (!match) return null
	const [, y, mo, d, h, mi, s] = match
	const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
	const parsed = new Date(iso)
	if (Number.isNaN(parsed.getTime())) return null
	return { date: parsed, floating: match[7] !== 'Z' }
}

// RFC 5545 §3.3.6: `PnDTnHnMnS` where any segment is optional. Used when a
// VEVENT carries DURATION instead of DTEND.
const parseDurationToMs = (value: string): number | null => {
	const m = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
	if (!m) return null
	const d = m[1] ? Number(m[1]) : 0
	const h = m[2] ? Number(m[2]) : 0
	const mi = m[3] ? Number(m[3]) : 0
	const s = m[4] ? Number(m[4]) : 0
	return (d * 86400 + h * 3600 + mi * 60 + s) * 1000
}

// Vendor URL extraction. First-match-wins order is Meet → Teams → Zoom; any
// losers ride along in `metadata.additional_video_urls` so we can revisit if
// forwarded threads contain multiple conferencing footers.
const MEET_URL_RE = /https:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i
const TEAMS_URL_RE =
	/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<]+/i
const ZOOM_URL_RE = /https:\/\/[a-z0-9-]+\.zoom\.us\/j\/\d+(?:\?[^\s"<]*)?/i

const extractMeetingUrl = (args: {
	readonly location: string | null
	readonly description: string | null
	readonly xGoogleConference: string | null
}): {
	url: string | null
	vendor: 'meet' | 'teams' | 'zoom' | null
	additional: ReadonlyArray<string>
} => {
	const sources: string[] = []
	if (args.xGoogleConference) sources.push(args.xGoogleConference)
	if (args.location) sources.push(args.location)
	if (args.description) sources.push(args.description)
	const joined = sources.join('\n')
	const meet = joined.match(MEET_URL_RE)?.[0] ?? null
	const teams = joined.match(TEAMS_URL_RE)?.[0] ?? null
	const zoom = joined.match(ZOOM_URL_RE)?.[0] ?? null
	if (meet) {
		const additional: string[] = []
		if (teams) additional.push(teams)
		if (zoom) additional.push(zoom)
		return { url: meet, vendor: 'meet', additional }
	}
	if (teams) {
		const additional: string[] = []
		if (zoom) additional.push(zoom)
		return { url: teams, vendor: 'teams', additional }
	}
	if (zoom) return { url: zoom, vendor: 'zoom', additional: [] }
	return { url: null, vendor: null, additional: [] }
}

// LOCATION fallback classifier. Only hit when `extractMeetingUrl` came up empty —
// otherwise the event is already `location_type='video'`.
const classifyLocation = (
	location: string | null,
): {
	type: 'address' | 'phone' | 'none'
	value: string | null
} => {
	if (!location) return { type: 'none', value: null }
	const trimmed = location.trim()
	if (!trimmed) return { type: 'none', value: null }
	if (/^tel:/i.test(trimmed)) {
		return { type: 'phone', value: trimmed.replace(/^tel:/i, '').trim() }
	}
	// E.164-ish: starts with + or digit, has 6+ digits, only phone-safe chars.
	if (/^\+?\d[\d\s\-()]{5,}$/.test(trimmed)) {
		return { type: 'phone', value: trimmed }
	}
	return { type: 'address', value: trimmed }
}

// ICS TEXT values escape commas, semicolons, and backslashes; newlines ride
// in as the two-character sequence "\n". Unescape before storing so the
// value matches what the sender typed.
const unescapeIcsText = (value: string): string =>
	value
		.replace(/\\n/g, '\n')
		.replace(/\\N/g, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\')

const parseVEvent = (block: string): ParsedVEvent | null => {
	const lineOf = (name: string): string | null => {
		const re = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'm')
		const m = block.match(re)
		return m?.[1]?.trim() ?? null
	}
	const uid = lineOf('UID')
	const dtStartRaw = block.match(/^DTSTART(?:;[^:\r\n]*)?:(\S+)/m)?.[1]
	const dtEndRaw = block.match(/^DTEND(?:;[^:\r\n]*)?:(\S+)/m)?.[1]
	if (!uid || !dtStartRaw) return null

	const startParsed = parseIcsDate(dtStartRaw)
	if (!startParsed) return null
	const startAt = startParsed.date

	let endAt: Date | null = null
	if (dtEndRaw) {
		const endParsed = parseIcsDate(dtEndRaw)
		if (endParsed) endAt = endParsed.date
	}
	// DTEND missing → fall back to DURATION (RFC 5545 allows either, not both).
	if (!endAt) {
		const durationRaw = lineOf('DURATION')
		if (durationRaw) {
			const ms = parseDurationToMs(durationRaw)
			if (ms !== null) endAt = new Date(startAt.getTime() + ms)
		}
	}
	// Refusing to guess when both are missing keeps malformed invites from
	// silently landing as zero-length events in the grid.
	if (!endAt) return null

	const sequenceRaw = lineOf('SEQUENCE')
	const icalSequence = sequenceRaw ? Number.parseInt(sequenceRaw, 10) : 0
	const titleRaw = lineOf('SUMMARY') ?? ''
	const title = unescapeIcsText(titleRaw)
	const descriptionRaw = lineOf('DESCRIPTION')
	const description = descriptionRaw ? unescapeIcsText(descriptionRaw) : null
	const locationRaw = lineOf('LOCATION')
	const location = locationRaw ? unescapeIcsText(locationRaw) : null
	const xGoogleConference = lineOf('X-GOOGLE-CONFERENCE')

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

	const video = extractMeetingUrl({
		location,
		description,
		xGoogleConference,
	})
	const metadata: Record<string, unknown> = {}
	if (startParsed.floating) metadata['timezone'] = 'floating_assumed_utc'
	if (video.additional.length > 0) {
		metadata['additional_video_urls'] = video.additional
	}
	if (description) metadata['description'] = description
	if (video.vendor) metadata['video_vendor'] = video.vendor

	let locationType: ParsedVEvent['locationType']
	let locationValue: string | null
	if (video.url) {
		locationType = 'video'
		// Keep the human-readable LOCATION when provided (Teams uses "Microsoft
		// Teams Meeting" as LOCATION and buries the URL in DESCRIPTION); fall
		// back to the URL itself when LOCATION was empty.
		locationValue = location ?? video.url
	} else {
		const classified = classifyLocation(location)
		locationType = classified.type
		locationValue = classified.value
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
		locationType,
		locationValue,
		videoCallUrl: video.url,
		metadata,
	}
}

export const makeStubIcsParser = Effect.succeed(
	IcsParser.of({
		parse: (raw: Uint8Array) =>
			Effect.gen(function* () {
				const decoded = decode(raw)
				if (!decoded.includes('BEGIN:VCALENDAR')) {
					return yield* new InvalidIcs({ reason: 'not-a-vcalendar' })
				}
				const text = unfoldLines(decoded)
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
