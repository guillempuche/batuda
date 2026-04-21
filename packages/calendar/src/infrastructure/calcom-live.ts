/**
 * Cal.com v2 adapter — the ONLY file in this package that knows cal.com
 * exists. Everything above this boundary sees `BookingProvider` and
 * vendor-neutral domain types; adding a Google / Microsoft backend later is
 * a new adapter file, not a rename across the codebase.
 *
 * Cal-api-version is pinned per endpoint because cal.com versions each
 * surface independently — a single wrong header silently falls back to an
 * older version, so the map below is the canonical reference.
 *
 * Numeric upstream IDs (`eventType.id`, `booking.id`) are stringified at the
 * ingress boundary so the domain layer sees `string` everywhere and a future
 * provider that returns string IDs (Google / Microsoft) drops in unchanged.
 */

import { Config, Effect, Layer, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	type HttpClientResponse,
} from 'effect/unstable/http'

import { BookingProvider } from '../application/ports/booking-provider'
import type {
	CreateBookingInput,
	FindSlotsInput,
	ProviderBookingRef,
	ProviderEventTypeRef,
	RsvpInput,
	Slot,
	UpsertEventTypeInput,
} from '../domain/calendar-event'
import {
	BookingFailed,
	NoAvailability,
	UnsupportedRsvp,
} from '../domain/errors'

/**
 * Cal.com versions each endpoint independently. A wrong header silently
 * falls back to an older API version, so the map below is the source of
 * truth for every outgoing call. Verified against the official docs on
 * 2026-04-21: bookings → 2026-02-25, slots → 2024-09-04,
 * event-types → 2024-06-14.
 */
export const CALCOM_API_VERSION = {
	bookings: '2026-02-25',
	slots: '2024-09-04',
	eventTypes: '2024-06-14',
} as const

export type CalcomApiVersionKey = keyof typeof CALCOM_API_VERSION

export const CALCOM_DEFAULT_BASE_URL = 'https://api.cal.com/v2'

/** Default timezone used when the domain-level caller does not supply one.
 * Cal.com requires `attendee.timeZone` on every booking; UTC is the safest
 * default since all our `startAt` Dates are already UTC-normalised. */
export const CALCOM_DEFAULT_TIMEZONE = 'UTC'

const PROVIDER_NAME = 'calcom'

// ── Response shapes ────────────────────────────────────────────────────────
//
// Cal.com v2 wraps every response in an envelope: `{ status: 'success',
// data: … }` on 2xx or `{ status: 'error', error: { message: … } }` on 4xx+.
// Only the fields we actually consume are validated — the cal.com response
// payloads carry far more, but schema-strict decoding would break on any
// additive field they add upstream.

const BookingData = Schema.Struct({
	uid: Schema.String,
})

const EventTypeData = Schema.Struct({
	id: Schema.Union([Schema.Number, Schema.String]),
	title: Schema.String,
	slug: Schema.String,
	lengthInMinutes: Schema.Number,
})
type EventTypeData = typeof EventTypeData.Type

/** A slot in "range" format (`format=range`): both bounds are explicit. */
const SlotEntry = Schema.Struct({
	start: Schema.String,
	end: Schema.String,
})

/** Cal.com returns slots grouped by ISO-date key: `{ "2050-09-05": [...] }`. */
const SlotsResponse = Schema.Record(Schema.String, Schema.Array(SlotEntry))
type SlotsResponse = typeof SlotsResponse.Type

const ErrorEnvelope = Schema.Struct({
	status: Schema.Literal('error'),
	error: Schema.Struct({
		message: Schema.optional(Schema.String),
		code: Schema.optional(Schema.String),
	}),
})

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Stringify numeric cal.com ids on the way in. `String(…)` handles both
 * number and string cases so a future cal.com schema change that flips the
 * id type does not break us.
 */
export const stringifyId = (id: number | string): string => String(id)

const mapLocationKindToCalcom = (
	kind: UpsertEventTypeInput['locationKind'],
	value: string | null,
): ReadonlyArray<{ type: string; link?: string; address?: string }> => {
	switch (kind) {
		case 'video':
			return [{ type: 'integrations:daily' }]
		case 'phone':
		case 'address':
			return value ? [{ type: 'inPerson', address: value }] : []
		case 'link':
			return value ? [{ type: 'link', link: value }] : []
		case 'none':
			return []
	}
}

const eventTypeFromUpstream = (data: EventTypeData): ProviderEventTypeRef => ({
	provider: PROVIDER_NAME,
	providerEventTypeId: stringifyId(data.id),
	slug: data.slug,
	title: data.title,
	durationMinutes: data.lengthInMinutes,
	// Cal.com does not surface our domain's `locationKind` / `defaultLocationValue`
	// on list/fetch (it returns a `locations` array keyed by integration slug).
	// We default conservatively so a `listEventTypes` sync does not clobber a
	// locally-edited row — the calendar service reconciles by merging.
	locationKind: 'none',
	defaultLocationValue: null,
	active: true,
})

// ── Error mapping ──────────────────────────────────────────────────────────

const bookingFailed = (reason: string, recoverable: boolean) =>
	new BookingFailed({ provider: PROVIDER_NAME, reason, recoverable })

const classifyHttpStatus = (
	status: number,
): { readonly reason: string; readonly recoverable: boolean } => {
	if (status === 401 || status === 403) {
		return { reason: `unauthorized:${status}`, recoverable: false }
	}
	if (status === 404) {
		return { reason: 'not_found', recoverable: false }
	}
	if (status === 429) {
		return { reason: 'rate_limited', recoverable: true }
	}
	if (status >= 500) {
		return { reason: `server_error:${status}`, recoverable: true }
	}
	return { reason: `http_${status}`, recoverable: false }
}

const tryReadErrorMessage = (payload: unknown): string | null => {
	try {
		const decoded = Schema.decodeUnknownSync(ErrorEnvelope)(payload)
		return decoded.error.message ?? decoded.error.code ?? null
	} catch {
		return null
	}
}

// ── Slot flattening ────────────────────────────────────────────────────────

/**
 * Cal.com returns slots grouped by ISO date; flatten to a single ordered
 * list. Date keys are sorted ascending, entries within a day keep their
 * upstream order. `format=range` is always requested so both `start` and
 * `end` are present; malformed entries are dropped rather than failing the
 * whole response.
 */
export const flattenSlots = (grouped: SlotsResponse): ReadonlyArray<Slot> => {
	const slots: Slot[] = []
	const dateKeys = Object.keys(grouped).sort()
	for (const key of dateKeys) {
		const entries = grouped[key] ?? []
		for (const entry of entries) {
			const start = new Date(entry.start)
			const end = new Date(entry.end)
			if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
				slots.push({ start, end })
			}
		}
	}
	return slots
}

// ── Request body builders ──────────────────────────────────────────────────

export interface CalcomBookingBody {
	readonly start: string
	readonly eventTypeId: number
	readonly attendee: {
		readonly name: string
		readonly email: string
		readonly timeZone: string
	}
	readonly guests?: ReadonlyArray<string>
	readonly metadata?: Record<string, unknown>
}

/**
 * Map our port's `CreateBookingInput` to cal.com's `/v2/bookings` body
 * (`cal-api-version: 2026-02-25`). Cal.com expects a single primary
 * `attendee` plus an optional `guests` array of emails; we take
 * `attendees[0]` as the primary and fan the rest into `guests`. Metadata
 * keys are string-valued per cal.com limits (40-char keys, 500-char
 * string values), so we pass through as-is — callers own validation.
 */
export const buildCreateBookingBody = (
	input: CreateBookingInput,
): CalcomBookingBody => {
	const [primary, ...rest] = input.attendees
	if (!primary) {
		throw new Error('buildCreateBookingBody: at least one attendee required')
	}
	const body: CalcomBookingBody = {
		start: input.startAt.toISOString(),
		eventTypeId: Number.parseInt(input.providerEventTypeId, 10),
		attendee: {
			name: primary.name ?? primary.email,
			email: primary.email,
			timeZone: CALCOM_DEFAULT_TIMEZONE,
		},
		...(rest.length > 0 ? { guests: rest.map(a => a.email) } : {}),
		...(input.metadata ? { metadata: input.metadata } : {}),
	}
	return body
}

// ── Adapter construction ───────────────────────────────────────────────────

export interface CalcomAdapterConfig {
	readonly apiKey: Redacted.Redacted<string>
	readonly baseUrl: string
}

const authHeader = (apiKey: Redacted.Redacted<string>) =>
	`Bearer ${Redacted.value(apiKey)}`

const versionHeaderFor = (
	key: CalcomApiVersionKey,
): Record<string, string> => ({
	'cal-api-version': CALCOM_API_VERSION[key],
})

/**
 * Decode a cal.com response envelope into the caller's data type.
 *
 * On 2xx, pulls the `data` field out of the success envelope with whatever
 * decoder the caller provided. On non-2xx, peeks at the body once to recover
 * an upstream error message, then fails with a classified `BookingFailed`.
 * Any JSON / schema mismatch collapses to a non-recoverable failure so the
 * calendar service never has to narrow a cross-layer error type.
 */
const SuccessShell = Schema.Struct({
	status: Schema.Literal('success'),
	data: Schema.Unknown,
})

const readEnvelope = <S extends Schema.Top>(
	response: HttpClientResponse.HttpClientResponse,
	schema: S,
): Effect.Effect<S['Type'], BookingFailed, S['DecodingServices']> =>
	Effect.gen(function* () {
		const status = response.status
		const json: unknown = yield* response.json.pipe(
			Effect.mapError(() => bookingFailed('invalid_json', false)),
		)

		if (status >= 200 && status < 300) {
			const shell = yield* Schema.decodeUnknownEffect(SuccessShell)(json).pipe(
				Effect.mapError(() =>
					bookingFailed('unexpected_response_shape', false),
				),
			)
			return yield* Schema.decodeUnknownEffect(schema)(shell.data).pipe(
				Effect.mapError(() =>
					bookingFailed('unexpected_response_shape', false),
				),
			)
		}

		const upstreamMessage = tryReadErrorMessage(json)
		const { reason, recoverable } = classifyHttpStatus(status)
		const suffix = upstreamMessage ? `:${upstreamMessage}` : ''
		return yield* Effect.fail(bookingFailed(`${reason}${suffix}`, recoverable))
	})

/**
 * Build a cal.com-backed `BookingProvider`. Takes an `HttpClient` from the
 * runtime so tests can inject an in-memory stub via a `HttpClient.make`
 * layer.
 */
export const makeCalcomBookingProvider = (config: CalcomAdapterConfig) =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient

		const authorized = (versionKey: CalcomApiVersionKey) => ({
			Authorization: authHeader(config.apiKey),
			Accept: 'application/json',
			...versionHeaderFor(versionKey),
		})

		const findSlots = ({
			providerEventTypeId,
			from,
			to,
		}: FindSlotsInput): Effect.Effect<
			ReadonlyArray<Slot>,
			BookingFailed | NoAvailability
		> =>
			Effect.gen(function* () {
				const request = HttpClientRequest.get(`${config.baseUrl}/slots`, {
					urlParams: {
						eventTypeId: providerEventTypeId,
						start: from.toISOString(),
						end: to.toISOString(),
						format: 'range',
					},
					headers: authorized('slots'),
				})
				const response = yield* client
					.execute(request)
					.pipe(Effect.mapError(() => bookingFailed('network_error', true)))
				const grouped = yield* readEnvelope(response, SlotsResponse)
				const flattened = flattenSlots(grouped)
				if (flattened.length === 0) {
					return yield* new NoAvailability({
						eventTypeId: providerEventTypeId,
						fromIso: from.toISOString(),
						toIso: to.toISOString(),
					})
				}
				return flattened
			})

		const createBooking = (
			input: CreateBookingInput,
		): Effect.Effect<ProviderBookingRef, BookingFailed> =>
			Effect.gen(function* () {
				const body = yield* Effect.try({
					try: () => buildCreateBookingBody(input),
					catch: () => bookingFailed('missing_primary_attendee', false),
				})
				const request = HttpClientRequest.post(
					`${config.baseUrl}/bookings`,
				).pipe(
					HttpClientRequest.setHeaders(authorized('bookings')),
					HttpClientRequest.bodyJsonUnsafe(body),
				)
				const response = yield* client
					.execute(request)
					.pipe(Effect.mapError(() => bookingFailed('network_error', true)))
				const data = yield* readEnvelope(response, BookingData)
				return {
					provider: PROVIDER_NAME,
					providerBookingId: data.uid,
					icalUid: data.uid,
					icalSequence: 0,
				} satisfies ProviderBookingRef
			})

		const rescheduleBooking = (
			providerBookingId: string,
			newStartAt: Date,
		): Effect.Effect<ProviderBookingRef, BookingFailed> =>
			Effect.gen(function* () {
				const body = { start: newStartAt.toISOString() }
				const request = HttpClientRequest.post(
					`${config.baseUrl}/bookings/${providerBookingId}/reschedule`,
				).pipe(
					HttpClientRequest.setHeaders(authorized('bookings')),
					HttpClientRequest.bodyJsonUnsafe(body),
				)
				const response = yield* client
					.execute(request)
					.pipe(Effect.mapError(() => bookingFailed('network_error', true)))
				const data = yield* readEnvelope(response, BookingData)
				return {
					provider: PROVIDER_NAME,
					providerBookingId: data.uid,
					icalUid: data.uid,
					icalSequence: 0,
				} satisfies ProviderBookingRef
			})

		const cancelBooking = (
			providerBookingId: string,
			reason: string | null,
		): Effect.Effect<void, BookingFailed> =>
			Effect.gen(function* () {
				const body = reason ? { cancellationReason: reason } : {}
				const request = HttpClientRequest.post(
					`${config.baseUrl}/bookings/${providerBookingId}/cancel`,
				).pipe(
					HttpClientRequest.setHeaders(authorized('bookings')),
					HttpClientRequest.bodyJsonUnsafe(body),
				)
				const response = yield* client
					.execute(request)
					.pipe(Effect.mapError(() => bookingFailed('network_error', true)))
				yield* readEnvelope(response, Schema.Unknown)
			})

		const respondToRsvp = ({
			providerBookingId,
			rsvp,
			comment,
		}: RsvpInput): Effect.Effect<void, BookingFailed | UnsupportedRsvp> =>
			Effect.gen(function* () {
				if (rsvp === 'tentative') {
					return yield* new UnsupportedRsvp({
						provider: PROVIDER_NAME,
						rsvp: 'tentative',
					})
				}
				const action = rsvp === 'accepted' ? 'accept' : 'decline'
				const body = comment ? { reason: comment } : {}
				const request = HttpClientRequest.post(
					`${config.baseUrl}/bookings/${providerBookingId}/${action}`,
				).pipe(
					HttpClientRequest.setHeaders(authorized('bookings')),
					HttpClientRequest.bodyJsonUnsafe(body),
				)
				const response = yield* client
					.execute(request)
					.pipe(Effect.mapError(() => bookingFailed('network_error', true)))
				yield* readEnvelope(response, Schema.Unknown)
			})

		const listEventTypes = (): Effect.Effect<
			ReadonlyArray<ProviderEventTypeRef>,
			BookingFailed
		> =>
			Effect.gen(function* () {
				const request = HttpClientRequest.get(`${config.baseUrl}/event-types`, {
					headers: authorized('eventTypes'),
				})
				const response = yield* client
					.execute(request)
					.pipe(Effect.mapError(() => bookingFailed('network_error', true)))
				const data = yield* readEnvelope(response, Schema.Array(EventTypeData))
				return data.map(eventTypeFromUpstream)
			})

		const upsertEventType = (
			input: UpsertEventTypeInput,
		): Effect.Effect<ProviderEventTypeRef, BookingFailed> =>
			Effect.gen(function* () {
				const body = {
					title: input.title,
					slug: input.slug,
					lengthInMinutes: input.durationMinutes,
					locations: mapLocationKindToCalcom(
						input.locationKind,
						input.defaultLocationValue,
					),
				}
				const request = HttpClientRequest.post(
					`${config.baseUrl}/event-types`,
				).pipe(
					HttpClientRequest.setHeaders(authorized('eventTypes')),
					HttpClientRequest.bodyJsonUnsafe(body),
				)
				const response = yield* client
					.execute(request)
					.pipe(Effect.mapError(() => bookingFailed('network_error', true)))
				const data = yield* readEnvelope(response, EventTypeData)
				return eventTypeFromUpstream(data)
			})

		return BookingProvider.of({
			findSlots,
			createBooking,
			rescheduleBooking,
			cancelBooking,
			respondToRsvp,
			listEventTypes,
			upsertEventType,
		})
	})

// ── Layer construction ─────────────────────────────────────────────────────

/**
 * Build a cal.com `BookingProvider` layer from env config. Reads:
 *   - `CALENDAR_API_KEY`  (required, redacted)
 *   - `CALENDAR_BASE_URL` (optional; default https://api.cal.com/v2)
 *
 * The layer depends on `HttpClient.HttpClient`, which the runtime provides
 * via `FetchHttpClient.layer` at the app root.
 */
export const CalcomBookingProviderLayer = Layer.effect(
	BookingProvider,
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted('CALENDAR_API_KEY')
		const baseUrl = yield* Config.string('CALENDAR_BASE_URL').pipe(
			Config.withDefault(CALCOM_DEFAULT_BASE_URL),
		)
		yield* Effect.logInfo('calendar.provider.calcom').pipe(
			Effect.annotateLogs({
				event: 'calendar.provider.calcom.initialized',
				baseUrl,
			}),
		)
		return yield* makeCalcomBookingProvider({ apiKey, baseUrl })
	}),
)
