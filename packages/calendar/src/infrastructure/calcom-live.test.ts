import { Effect, Redacted } from 'effect'
import {
	HttpClient,
	type HttpClientError,
	type HttpClientRequest,
	type HttpClientResponse,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { BookingProvider } from '../application/ports/booking-provider'
import type { CreateBookingInput } from '../domain/calendar-event'
import {
	BookingFailed,
	NoAvailability,
	UnsupportedRsvp,
} from '../domain/errors'
import {
	buildCreateBookingBody,
	CALCOM_API_VERSION,
	CALCOM_DEFAULT_BASE_URL,
	CALCOM_DEFAULT_TIMEZONE,
	flattenSlots,
	makeCalcomBookingProvider,
	stringifyId,
} from './calcom-live'

// ── Test helpers ─────────────────────────────────────────────────────────────

const fakeApiKey = Redacted.make('cal_test_123')

/** Build a minimal `HttpClientResponse` from a status + body JSON object. */
const jsonResponse = (
	request: HttpClientRequest.HttpClientRequest,
	status: number,
	body: unknown,
): HttpClientResponse.HttpClientResponse =>
	HttpClientResponseNs.fromWeb(
		request,
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		}),
	)

/** Capture-then-respond mock HttpClient. The first request is recorded on
 * `box.request`; the handler returns the canned response. */
interface RequestBox {
	request: HttpClientRequest.HttpClientRequest | undefined
}

const mockHttpClient = (
	box: RequestBox,
	respond: (
		request: HttpClientRequest.HttpClientRequest,
	) => HttpClientResponse.HttpClientResponse,
): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.flatMap(effect, request => {
				box.request = request
				return Effect.succeed(respond(request))
			}),
		Effect.succeed,
	)

const runWithClient = <A, E>(
	effect: Effect.Effect<A, E, BookingProvider>,
	client: HttpClient.HttpClient,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const provider = yield* makeCalcomBookingProvider({
				apiKey: fakeApiKey,
				baseUrl: CALCOM_DEFAULT_BASE_URL,
			})
			return yield* effect.pipe(
				Effect.provideService(BookingProvider, provider),
			)
		}).pipe(Effect.provideService(HttpClient.HttpClient, client)),
	)

// ── CALCOM_API_VERSION ────────────────────────────────────────────────────────

describe('CALCOM_API_VERSION', () => {
	it('should pin each endpoint to its published api version', () => {
		// GIVEN the adapter's per-endpoint header map
		// THEN each endpoint maps to the version verified against cal.com docs
		// AND the map is the single source of truth for outbound headers
		expect(CALCOM_API_VERSION).toEqual({
			bookings: '2026-02-25',
			slots: '2024-09-04',
			eventTypes: '2024-06-14',
		})
	})
})

// ── stringifyId ──────────────────────────────────────────────────────────────

describe('stringifyId', () => {
	it('should stringify a numeric id so the domain sees text', () => {
		// GIVEN cal.com returns a numeric event-type id
		// WHEN the adapter normalises it at ingress
		// THEN the domain receives a string
		expect(stringifyId(12345)).toBe('12345')
	})

	it('should pass a string id through unchanged', () => {
		// GIVEN a provider that returns string ids (Google, Microsoft)
		// WHEN the same normaliser is applied
		// THEN the string value is preserved
		expect(stringifyId('evt_abc')).toBe('evt_abc')
	})
})

// ── flattenSlots ─────────────────────────────────────────────────────────────

describe('flattenSlots', () => {
	it('should return an empty array when the response has no date keys', () => {
		// GIVEN an empty grouped response
		// WHEN it is flattened
		// THEN the result has no slots
		expect(flattenSlots({})).toEqual([])
	})

	it('should sort date keys ascending and preserve intra-day order', () => {
		// GIVEN entries grouped across three days with a later day first
		// WHEN the response is flattened
		// THEN slots come out in ascending date order and each day keeps its order
		const grouped = {
			'2050-09-06': [
				{ start: '2050-09-06T09:00:00Z', end: '2050-09-06T09:30:00Z' },
			],
			'2050-09-05': [
				{ start: '2050-09-05T10:00:00Z', end: '2050-09-05T10:30:00Z' },
				{ start: '2050-09-05T11:00:00Z', end: '2050-09-05T11:30:00Z' },
			],
		}

		const flat = flattenSlots(grouped)

		expect(flat.map(s => s.start.toISOString())).toEqual([
			'2050-09-05T10:00:00.000Z',
			'2050-09-05T11:00:00.000Z',
			'2050-09-06T09:00:00.000Z',
		])
	})

	it('should drop entries with unparseable start or end strings', () => {
		// GIVEN one malformed entry mixed with a valid one
		// WHEN the response is flattened
		// THEN only the valid entry survives and the malformed one is skipped
		const grouped = {
			'2050-09-05': [
				{ start: 'not-a-date', end: '2050-09-05T10:30:00Z' },
				{ start: '2050-09-05T11:00:00Z', end: '2050-09-05T11:30:00Z' },
			],
		}

		const flat = flattenSlots(grouped)

		expect(flat).toHaveLength(1)
		expect(flat[0]?.start.toISOString()).toBe('2050-09-05T11:00:00.000Z')
	})
})

// ── buildCreateBookingBody ───────────────────────────────────────────────────

const bookingInput = (
	overrides: Partial<CreateBookingInput> = {},
): CreateBookingInput => ({
	providerEventTypeId: '42',
	startAt: new Date('2050-09-05T09:00:00Z'),
	attendees: [{ email: 'primary@example.com', name: 'Primary User' }],
	metadata: null,
	...overrides,
})

describe('buildCreateBookingBody', () => {
	it('should map the primary attendee into the singular cal.com attendee field', () => {
		// GIVEN a single-attendee booking input
		// WHEN the body is built
		// THEN the primary attendee carries name + email + UTC timezone
		// AND `guests` is omitted because there are no secondary attendees
		const body = buildCreateBookingBody(bookingInput())

		expect(body.attendee).toEqual({
			name: 'Primary User',
			email: 'primary@example.com',
			timeZone: CALCOM_DEFAULT_TIMEZONE,
		})
		expect(body.guests).toBeUndefined()
	})

	it('should fan secondary attendees into the guests array as emails only', () => {
		// GIVEN three attendees
		// WHEN the body is built
		// THEN attendees[0] becomes the primary
		// AND attendees[1..n] become an email-only `guests` array
		const body = buildCreateBookingBody(
			bookingInput({
				attendees: [
					{ email: 'a@example.com', name: 'A' },
					{ email: 'b@example.com', name: 'B' },
					{ email: 'c@example.com', name: null },
				],
			}),
		)

		expect(body.attendee.email).toBe('a@example.com')
		expect(body.guests).toEqual(['b@example.com', 'c@example.com'])
	})

	it('should fall back to the email when the primary attendee has no name', () => {
		// GIVEN a primary attendee without a display name
		// WHEN the body is built
		// THEN the email doubles as the name so cal.com has a non-empty value
		const body = buildCreateBookingBody(
			bookingInput({
				attendees: [{ email: 'noname@example.com', name: null }],
			}),
		)

		expect(body.attendee.name).toBe('noname@example.com')
	})

	it('should stringify-parse the event-type id into a numeric eventTypeId', () => {
		// GIVEN a string providerEventTypeId (domain-level shape)
		// WHEN the body is built
		// THEN the outgoing field is a number for the cal.com wire format
		const body = buildCreateBookingBody(
			bookingInput({ providerEventTypeId: '12345' }),
		)

		expect(body.eventTypeId).toBe(12345)
	})

	it('should emit the start time as an ISO-8601 string', () => {
		// GIVEN a UTC startAt Date
		// WHEN the body is built
		// THEN the outgoing `start` field is the same instant in ISO-8601
		const body = buildCreateBookingBody(
			bookingInput({ startAt: new Date('2050-09-05T09:15:00Z') }),
		)

		expect(body.start).toBe('2050-09-05T09:15:00.000Z')
	})

	it('should include metadata verbatim when provided and omit it otherwise', () => {
		// GIVEN two inputs — one with metadata and one without
		// WHEN both are built
		// THEN the metadata key is present only when the caller supplied it
		const withMeta = buildCreateBookingBody(
			bookingInput({ metadata: { source: 'batuda' } }),
		)
		const withoutMeta = buildCreateBookingBody(bookingInput())

		expect(withMeta.metadata).toEqual({ source: 'batuda' })
		expect(withoutMeta.metadata).toBeUndefined()
	})

	it('should refuse to build a body when no attendees are present', () => {
		// GIVEN an input with zero attendees
		// WHEN the body is built
		// THEN an error is thrown so the adapter fails before hitting the network
		expect(() =>
			buildCreateBookingBody(bookingInput({ attendees: [] })),
		).toThrow(/at least one attendee required/)
	})
})

// ── makeCalcomBookingProvider: outgoing request shape ────────────────────────
//
// Per plan §13 this is the lockdown suite — any drift in cal-api-version
// between endpoints would silently fall back to an older upstream version,
// so each endpoint's header is asserted explicitly.

describe('makeCalcomBookingProvider — outgoing request shape', () => {
	it('should hit /v2/slots with GET + slots api-version header', async () => {
		// GIVEN a stubbed HttpClient that records the outbound request
		// WHEN findSlots is invoked
		// THEN the method is GET, the url contains /slots + format=range,
		// AND the cal-api-version header is the slots version
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, {
				status: 'success',
				data: {
					'2050-09-05': [
						{
							start: '2050-09-05T09:00:00Z',
							end: '2050-09-05T09:30:00Z',
						},
					],
				},
			}),
		)

		const slots = await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.findSlots({
					providerEventTypeId: '42',
					from: new Date('2050-09-05T00:00:00Z'),
					to: new Date('2050-09-06T00:00:00Z'),
				})
			}),
			client,
		)

		expect(slots).toHaveLength(1)
		expect(box.request?.method).toBe('GET')
		expect(box.request?.url).toContain('/slots')
		const params = [...(box.request?.urlParams ?? [])]
		expect(params).toEqual(
			expect.arrayContaining([
				['eventTypeId', '42'],
				['format', 'range'],
			]),
		)
		expect(box.request?.headers['cal-api-version']).toBe(
			CALCOM_API_VERSION.slots,
		)
	})

	it('should hit POST /v2/bookings with bookings api-version header', async () => {
		// GIVEN a stubbed HttpClient returning a booking envelope
		// WHEN createBooking is invoked
		// THEN the method is POST, the url ends in /bookings,
		// AND the cal-api-version header is the bookings version
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, {
				status: 'success',
				data: { uid: 'bkg_123' },
			}),
		)

		const ref = await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.createBooking(bookingInput())
			}),
			client,
		)

		expect(ref.provider).toBe('calcom')
		expect(ref.providerBookingId).toBe('bkg_123')
		expect(ref.icalUid).toBe('bkg_123')
		expect(box.request?.method).toBe('POST')
		expect(box.request?.url).toContain('/bookings')
		expect(box.request?.headers['cal-api-version']).toBe(
			CALCOM_API_VERSION.bookings,
		)
		expect(box.request?.headers['authorization']).toBe(
			`Bearer ${Redacted.value(fakeApiKey)}`,
		)
	})

	it('should hit /bookings/{uid}/reschedule on reschedule', async () => {
		// GIVEN an existing booking uid
		// WHEN rescheduleBooking is invoked
		// THEN the url targets /bookings/<uid>/reschedule
		// AND the bookings cal-api-version is sent
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, {
				status: 'success',
				data: { uid: 'bkg_rescheduled' },
			}),
		)

		await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.rescheduleBooking(
					'bkg_original',
					new Date('2050-09-06T09:00:00Z'),
				)
			}),
			client,
		)

		expect(box.request?.url).toContain('/bookings/bkg_original/reschedule')
		expect(box.request?.headers['cal-api-version']).toBe(
			CALCOM_API_VERSION.bookings,
		)
	})

	it('should hit /bookings/{uid}/cancel on cancel', async () => {
		// GIVEN an existing booking uid
		// WHEN cancelBooking is invoked
		// THEN the url targets /bookings/<uid>/cancel
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, { status: 'success', data: {} }),
		)

		await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.cancelBooking('bkg_to_cancel', 'no show')
			}),
			client,
		)

		expect(box.request?.url).toContain('/bookings/bkg_to_cancel/cancel')
		expect(box.request?.method).toBe('POST')
	})

	it('should hit /bookings/{uid}/accept on RSVP accepted', async () => {
		// GIVEN an rsvp input with `accepted`
		// WHEN respondToRsvp is invoked
		// THEN the url targets /accept (not a body field on a generic endpoint)
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, { status: 'success', data: {} }),
		)

		await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.respondToRsvp({
					providerBookingId: 'bkg_rsvp',
					rsvp: 'accepted',
					comment: null,
				})
			}),
			client,
		)

		expect(box.request?.url).toContain('/bookings/bkg_rsvp/accept')
	})

	it('should hit /bookings/{uid}/decline on RSVP declined', async () => {
		// GIVEN an rsvp input with `declined`
		// WHEN respondToRsvp is invoked
		// THEN the url targets /decline
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, { status: 'success', data: {} }),
		)

		await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.respondToRsvp({
					providerBookingId: 'bkg_rsvp',
					rsvp: 'declined',
					comment: null,
				})
			}),
			client,
		)

		expect(box.request?.url).toContain('/bookings/bkg_rsvp/decline')
	})

	it('should reject tentative RSVPs without making a network call', async () => {
		// GIVEN a provider that would error if the HttpClient was invoked
		// WHEN respondToRsvp is called with `tentative`
		// THEN the error is UnsupportedRsvp
		// AND no HTTP request was issued (cal.com has no tentative endpoint)
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, () => {
			throw new Error('HttpClient should not be invoked for tentative RSVP')
		})

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* makeCalcomBookingProvider({
					apiKey: fakeApiKey,
					baseUrl: CALCOM_DEFAULT_BASE_URL,
				})
				return yield* provider.respondToRsvp({
					providerBookingId: 'bkg_rsvp',
					rsvp: 'tentative',
					comment: null,
				})
			}).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.catch((err: unknown) => Effect.succeed(err)),
			),
		)

		expect(result).toBeInstanceOf(UnsupportedRsvp)
		expect(box.request).toBeUndefined()
	})

	it('should hit GET /v2/event-types with event-types api-version header', async () => {
		// GIVEN a stubbed HttpClient returning a single event type
		// WHEN listEventTypes is invoked
		// THEN the url is /event-types, the method GET,
		// AND the cal-api-version matches the event-types version
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, {
				status: 'success',
				data: [
					{
						id: 42,
						title: 'Discovery',
						slug: 'discovery',
						lengthInMinutes: 30,
					},
				],
			}),
		)

		const refs = await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.listEventTypes()
			}),
			client,
		)

		expect(refs).toHaveLength(1)
		expect(refs[0]?.providerEventTypeId).toBe('42')
		expect(box.request?.method).toBe('GET')
		expect(box.request?.url).toContain('/event-types')
		expect(box.request?.headers['cal-api-version']).toBe(
			CALCOM_API_VERSION.eventTypes,
		)
	})

	it('should hit POST /v2/event-types and stringify the returned numeric id', async () => {
		// GIVEN cal.com returns a numeric event-type id
		// WHEN upsertEventType is invoked
		// THEN the domain-level ref carries the string form of the id
		// AND the outgoing cal-api-version header is the event-types version
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, {
				status: 'success',
				data: {
					id: 99999,
					title: 'Demo',
					slug: 'demo',
					lengthInMinutes: 45,
				},
			}),
		)

		const ref = await runWithClient(
			Effect.gen(function* () {
				const provider = yield* BookingProvider
				return yield* provider.upsertEventType({
					slug: 'demo',
					title: 'Demo',
					durationMinutes: 45,
					locationKind: 'video',
					defaultLocationValue: null,
				})
			}),
			client,
		)

		expect(ref.providerEventTypeId).toBe('99999')
		expect(ref.durationMinutes).toBe(45)
		expect(box.request?.method).toBe('POST')
		expect(box.request?.headers['cal-api-version']).toBe(
			CALCOM_API_VERSION.eventTypes,
		)
	})
})

// ── makeCalcomBookingProvider — response mapping ─────────────────────────────

describe('makeCalcomBookingProvider — response mapping', () => {
	it('should raise NoAvailability when the slot window is empty', async () => {
		// GIVEN cal.com returns a success envelope with zero slots
		// WHEN findSlots is invoked
		// THEN the port returns `NoAvailability` (not an empty array),
		// so callers can distinguish "no rooms" from "network failure"
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, { status: 'success', data: {} }),
		)

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* makeCalcomBookingProvider({
					apiKey: fakeApiKey,
					baseUrl: CALCOM_DEFAULT_BASE_URL,
				})
				return yield* provider.findSlots({
					providerEventTypeId: '42',
					from: new Date('2050-09-05T00:00:00Z'),
					to: new Date('2050-09-06T00:00:00Z'),
				})
			}).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.catch((err: unknown) => Effect.succeed(err)),
			),
		)

		expect(result).toBeInstanceOf(NoAvailability)
	})

	it('should classify a 401 as non-recoverable unauthorized failure', async () => {
		// GIVEN cal.com rejects the call with 401 + error envelope
		// WHEN the adapter runs
		// THEN BookingFailed is raised with recoverable=false and the upstream
		// message preserved in the reason suffix
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 401, {
				status: 'error',
				error: { message: 'bad api key' },
			}),
		)

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* makeCalcomBookingProvider({
					apiKey: fakeApiKey,
					baseUrl: CALCOM_DEFAULT_BASE_URL,
				})
				return yield* provider.listEventTypes()
			}).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.catch((err: unknown) => Effect.succeed(err)),
			),
		)

		expect(result).toBeInstanceOf(BookingFailed)
		const failed = result as BookingFailed
		expect(failed.recoverable).toBe(false)
		expect(failed.reason).toContain('unauthorized:401')
		expect(failed.reason).toContain('bad api key')
	})

	it('should classify a 429 as a recoverable rate-limit failure', async () => {
		// GIVEN cal.com returns 429
		// WHEN the adapter runs
		// THEN BookingFailed is raised with recoverable=true so the caller
		// can decide whether to retry
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 429, { status: 'error', error: {} }),
		)

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* makeCalcomBookingProvider({
					apiKey: fakeApiKey,
					baseUrl: CALCOM_DEFAULT_BASE_URL,
				})
				return yield* provider.listEventTypes()
			}).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.catch((err: unknown) => Effect.succeed(err)),
			),
		)

		expect(result).toBeInstanceOf(BookingFailed)
		expect((result as BookingFailed).recoverable).toBe(true)
		expect((result as BookingFailed).reason).toContain('rate_limited')
	})

	it('should classify a 5xx as a recoverable server-error failure', async () => {
		// GIVEN cal.com returns 503
		// WHEN the adapter runs
		// THEN BookingFailed is raised with recoverable=true
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 503, { status: 'error', error: {} }),
		)

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* makeCalcomBookingProvider({
					apiKey: fakeApiKey,
					baseUrl: CALCOM_DEFAULT_BASE_URL,
				})
				return yield* provider.listEventTypes()
			}).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.catch((err: unknown) => Effect.succeed(err)),
			),
		)

		expect(result).toBeInstanceOf(BookingFailed)
		expect((result as BookingFailed).recoverable).toBe(true)
		expect((result as BookingFailed).reason).toContain('server_error:503')
	})

	it('should flag a malformed success envelope as unexpected_response_shape', async () => {
		// GIVEN cal.com returns 200 with a body that does not match our schema
		// WHEN the adapter decodes the envelope
		// THEN BookingFailed(reason='unexpected_response_shape', recoverable=false)
		const box: RequestBox = { request: undefined }
		const client = mockHttpClient(box, request =>
			jsonResponse(request, 200, { nonsense: true }),
		)

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* makeCalcomBookingProvider({
					apiKey: fakeApiKey,
					baseUrl: CALCOM_DEFAULT_BASE_URL,
				})
				return yield* provider.listEventTypes()
			}).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.catch((err: unknown) => Effect.succeed(err)),
			),
		)

		expect(result).toBeInstanceOf(BookingFailed)
		expect((result as BookingFailed).reason).toBe('unexpected_response_shape')
	})
})
