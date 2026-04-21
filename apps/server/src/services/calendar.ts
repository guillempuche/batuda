import { Data, Effect, Layer, Schema, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	BookingFailed,
	BookingProvider,
	type CalendarAttendeeRsvp,
	type CalendarLocationType,
	IcsParser,
	InvalidIcs,
	NoAvailability,
	type ParsedAttendee,
	type ParsedIcs,
	type Slot,
	UnsupportedRsvp,
} from '@batuda/calendar'

import {
	Ambiguous,
	CreatedContact,
	MatchedCompanyOnly,
	MatchedContact,
	NoMatch,
	ParticipantMatcher,
} from './participant-matcher'
import {
	MeetingCancelled,
	MeetingRescheduled,
	MeetingRsvp,
	MeetingScheduled,
	TimelineActivityService,
} from './timeline-activity'

// ── Service-level errors ───────────────────────────────────────────
// Narrow tagged classes kept at the service boundary so handlers +
// MCP tools can pattern-match without bleeding provider SDK errors.

export class CalendarEventNotFound extends Data.TaggedClass(
	'CalendarEventNotFound',
)<{
	readonly calendarEventId: string
}> {}

export class InvalidRsvpTarget extends Data.TaggedClass('InvalidRsvpTarget')<{
	readonly calendarEventId: string
	readonly reason: string
}> {}

export class CannotRsvpForSomeoneElse extends Data.TaggedClass(
	'CannotRsvpForSomeoneElse',
)<{
	readonly calendarEventId: string
	readonly attendeeEmail: string
	readonly requestedBy: string
}> {}

// ── Cal.com webhook envelope ───────────────────────────────────────
// Shape per cal.com v2 webhook docs. Unknown fields on `payload` are
// kept loose (Schema.Unknown everywhere optional) so new triggers don't
// 4xx us — the handler logs & noops. Only the fields we branch on are
// strongly typed.

const CalcomAttendeeSchema = Schema.Struct({
	email: Schema.String,
	name: Schema.optional(Schema.String),
})

export const CalcomWebhookPayloadSchema = Schema.Struct({
	iCalUID: Schema.optional(Schema.String),
	iCalSequence: Schema.optional(Schema.Number),
	bookingId: Schema.optional(Schema.Number),
	uid: Schema.optional(Schema.String),
	eventTypeId: Schema.optional(Schema.Number),
	title: Schema.optional(Schema.String),
	startTime: Schema.optional(Schema.String),
	endTime: Schema.optional(Schema.String),
	organizer: Schema.optional(
		Schema.Struct({
			email: Schema.optional(Schema.String),
			name: Schema.optional(Schema.String),
		}),
	),
	attendees: Schema.optional(Schema.Array(CalcomAttendeeSchema)),
	location: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	rescheduleStartTime: Schema.optional(Schema.String),
})

export const CalcomWebhookEnvelopeSchema = Schema.Struct({
	triggerEvent: Schema.String,
	createdAt: Schema.String,
	payload: CalcomWebhookPayloadSchema,
})

export type CalcomWebhookPayload = typeof CalcomWebhookPayloadSchema.Type
export type CalcomWebhookEnvelope = typeof CalcomWebhookEnvelopeSchema.Type

export const decodeCalcomWebhookEnvelope = Schema.decodeUnknownEffect(
	CalcomWebhookEnvelopeSchema,
)

// ── Internal shapes ────────────────────────────────────────────────

interface CalendarEventRow {
	readonly id: string
	readonly source: 'booking' | 'email' | 'internal'
	readonly provider: 'calcom' | 'google' | 'microsoft' | 'email' | 'internal'
	readonly icalUid: string
	readonly icalSequence: number
	readonly providerBookingId: string | null
	readonly startAt: Date
	readonly endAt: Date
	readonly status: 'confirmed' | 'tentative' | 'cancelled'
	readonly title: string
	readonly locationType: CalendarLocationType
	readonly locationValue: string | null
	readonly videoCallUrl: string | null
	readonly organizerEmail: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly interactionId: string | null
	readonly metadata: Record<string, unknown> | null
	readonly rawIcs: Uint8Array | null
}

interface EventTypeLookup {
	readonly id: string
	readonly slug: string
	readonly provider: string
	readonly providerEventTypeId: string | null
	readonly durationMinutes: number
}

const AVAILABILITY_CACHE_TTL_MS = 60 * 1000

/**
 * CalendarService owns:
 *  - cal.com webhook upserts (`handleCalcomWebhook`) with SEQUENCE-aware
 *    last-write-wins and timeline fan-out;
 *  - booking operations over the `BookingProvider` port (schedule /
 *    reschedule / cancel / RSVP);
 *  - email-sourced ICS ingest (parse → upsert → attendee resolution);
 *  - read helpers reused by both HTTP handlers and MCP tools.
 *
 * Every upsert runs inside a SQL transaction + fires a
 * `TimelineActivityService.record(...)` call so `companies.last_meeting_at`
 * and `companies.next_calendar_event_at` stay in lock-step with the
 * `calendar_events` row.
 */
export class CalendarService extends ServiceMap.Service<CalendarService>()(
	'CalendarService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const provider = yield* BookingProvider
			const parser = yield* IcsParser
			const timeline = yield* TimelineActivityService
			const participantMatcher = yield* ParticipantMatcher

			// Hot-path cache for slot queries so repeated callers within the
			// TTL don't fan out parallel provider calls for the same window.
			const slotCache = new Map<
				string,
				{ readonly expiresAt: number; readonly slots: ReadonlyArray<Slot> }
			>()

			const cacheKey = (
				providerEventTypeId: string,
				from: Date,
				to: Date,
			): string =>
				`${providerEventTypeId}|${from.toISOString()}|${to.toISOString()}`

			// ── Row helpers ─────────────────────────────────────────────
			const findByIcalUid = (icalUid: string) =>
				sql<CalendarEventRow>`
					SELECT * FROM calendar_events WHERE ical_uid = ${icalUid} LIMIT 1
				`.pipe(Effect.map(rows => rows[0] ?? null))

			const findById = (id: string) =>
				sql<CalendarEventRow>`
					SELECT * FROM calendar_events WHERE id = ${id} LIMIT 1
				`.pipe(Effect.map(rows => rows[0] ?? null))

			const loadEventType = (providerEventTypeId: string | null) =>
				providerEventTypeId
					? sql<EventTypeLookup>`
						SELECT id, slug, provider, provider_event_type_id, duration_minutes
						FROM calendar_event_types
						WHERE provider_event_type_id = ${providerEventTypeId}
						LIMIT 1
					`.pipe(Effect.map(rows => rows[0] ?? null))
					: Effect.succeed(null)

			const loadEventTypeById = (eventTypeId: string) =>
				sql<EventTypeLookup>`
					SELECT id, slug, provider, provider_event_type_id, duration_minutes
					FROM calendar_event_types
					WHERE id = ${eventTypeId}
					LIMIT 1
				`.pipe(Effect.map(rows => rows[0] ?? null))

			// ── Attendee resolution ─────────────────────────────────────
			// `createPolicy='contact-only'` so calendar ingest never invents
			// companies — only contacts under known company domains.
			const resolveAttendee = (attendee: {
				readonly email: string
				readonly name: string | null
			}) =>
				participantMatcher
					.match({
						email: attendee.email,
						createPolicy: 'contact-only',
						...(attendee.name ? { displayName: attendee.name } : {}),
					})
					.pipe(
						Effect.map(match => {
							if (
								match instanceof MatchedContact ||
								match instanceof CreatedContact
							) {
								return {
									contactId: match.contactId,
									companyId: match.companyId,
									matchNote: null as string | null,
								}
							}
							if (match instanceof MatchedCompanyOnly) {
								return {
									contactId: null,
									companyId: match.companyId,
									matchNote: 'company_only',
								}
							}
							if (match instanceof Ambiguous) {
								return {
									contactId: null,
									companyId: null,
									matchNote: 'ambiguous',
								}
							}
							if (match instanceof NoMatch) {
								return {
									contactId: null,
									companyId: null,
									matchNote: 'no_match',
								}
							}
							return { contactId: null, companyId: null, matchNote: null }
						}),
					)

			const upsertAttendees = (
				eventId: string,
				attendees: ReadonlyArray<{
					readonly email: string
					readonly name: string | null
					readonly rsvp: CalendarAttendeeRsvp
					readonly isOrganizer: boolean
				}>,
			) =>
				Effect.gen(function* () {
					for (const attendee of attendees) {
						const resolved = yield* resolveAttendee(attendee)
						yield* sql`
							INSERT INTO calendar_event_attendees ${sql.insert({
								eventId,
								email: attendee.email.toLowerCase(),
								name: attendee.name,
								contactId: resolved.contactId,
								companyId: resolved.companyId,
								rsvp: attendee.rsvp,
								isOrganizer: attendee.isOrganizer,
							})}
							ON CONFLICT (event_id, email) DO UPDATE SET
								name = EXCLUDED.name,
								contact_id = EXCLUDED.contact_id,
								company_id = EXCLUDED.company_id,
								rsvp = EXCLUDED.rsvp,
								is_organizer = EXCLUDED.is_organizer,
								updated_at = now()
						`
					}
				})

			// Derive event-level company/contact from the first non-organizer
			// attendee with a resolved contact. Callers can pass an explicit
			// override; the ICS ingest path relies on this fallback.
			const inferEventOwner = (
				attendees: ReadonlyArray<ParsedAttendee>,
			): Effect.Effect<
				{ companyId: string | null; contactId: string | null },
				never,
				never
			> =>
				Effect.gen(function* () {
					for (const attendee of attendees) {
						if (attendee.isOrganizer) continue
						const resolved = yield* resolveAttendee(attendee)
						if (resolved.contactId || resolved.companyId) {
							return {
								companyId: resolved.companyId,
								contactId: resolved.contactId,
							}
						}
					}
					return { companyId: null, contactId: null }
				})

			// ── Upsert helpers ──────────────────────────────────────────
			const upsertEventFromBooking = (args: {
				readonly icalUid: string
				readonly icalSequence: number
				readonly providerBookingId: string
				readonly provider: 'calcom' | 'google' | 'microsoft'
				readonly eventTypeId: string | null
				readonly startAt: Date
				readonly endAt: Date
				readonly status: 'confirmed' | 'tentative' | 'cancelled'
				readonly title: string
				readonly locationType: CalendarLocationType
				readonly locationValue: string | null
				readonly videoCallUrl: string | null
				readonly organizerEmail: string
				readonly companyId: string | null
				readonly contactId: string | null
				readonly metadata: Record<string, unknown> | null
			}) =>
				sql<CalendarEventRow>`
					INSERT INTO calendar_events ${sql.insert({
						source: 'booking',
						provider: args.provider,
						providerBookingId: args.providerBookingId,
						icalUid: args.icalUid,
						icalSequence: args.icalSequence,
						eventTypeId: args.eventTypeId,
						startAt: args.startAt,
						endAt: args.endAt,
						status: args.status,
						title: args.title,
						locationType: args.locationType,
						locationValue: args.locationValue,
						videoCallUrl: args.videoCallUrl,
						organizerEmail: args.organizerEmail,
						companyId: args.companyId,
						contactId: args.contactId,
						interactionId: null,
						metadata: args.metadata ? JSON.stringify(args.metadata) : null,
						rawIcs: null,
					})}
					ON CONFLICT (ical_uid) DO UPDATE SET
						ical_sequence = EXCLUDED.ical_sequence,
						provider_booking_id = EXCLUDED.provider_booking_id,
						provider = EXCLUDED.provider,
						event_type_id = EXCLUDED.event_type_id,
						start_at = EXCLUDED.start_at,
						end_at = EXCLUDED.end_at,
						status = EXCLUDED.status,
						title = EXCLUDED.title,
						location_type = EXCLUDED.location_type,
						location_value = EXCLUDED.location_value,
						video_call_url = EXCLUDED.video_call_url,
						organizer_email = EXCLUDED.organizer_email,
						company_id = EXCLUDED.company_id,
						contact_id = EXCLUDED.contact_id,
						metadata = EXCLUDED.metadata,
						updated_at = now()
					WHERE calendar_events.ical_sequence <= EXCLUDED.ical_sequence
					RETURNING *
				`.pipe(Effect.map(rows => rows[0] ?? null))

			const markCancelled = (icalUid: string, icalSequence: number) =>
				sql<CalendarEventRow>`
					UPDATE calendar_events SET
						status = 'cancelled',
						ical_sequence = GREATEST(ical_sequence, ${icalSequence}),
						updated_at = now()
					WHERE ical_uid = ${icalUid}
						AND ical_sequence <= ${icalSequence}
					RETURNING *
				`.pipe(Effect.map(rows => rows[0] ?? null))

			// ── Cal.com webhook handler ────────────────────────────────
			// Dispatches the five trigger families we care about + logs
			// unknowns without 4xx'ing (cal.com adds triggers over time).
			const handleCalcomWebhook = (envelope: CalcomWebhookEnvelope) =>
				Effect.gen(function* () {
					switch (envelope.triggerEvent) {
						case 'BOOKING_CREATED':
							yield* ingestCalcomBooking(envelope.payload, 'confirmed')
							return { handled: true, trigger: envelope.triggerEvent }
						case 'BOOKING_REQUESTED':
							yield* ingestCalcomBooking(envelope.payload, 'tentative')
							return { handled: true, trigger: envelope.triggerEvent }
						case 'BOOKING_RESCHEDULED':
							yield* ingestCalcomReschedule(envelope.payload)
							return { handled: true, trigger: envelope.triggerEvent }
						case 'BOOKING_CANCELLED':
						case 'BOOKING_REJECTED':
							yield* ingestCalcomCancel(envelope.payload)
							return { handled: true, trigger: envelope.triggerEvent }
						case 'MEETING_ENDED':
							yield* handleMeetingEnded(envelope.payload)
							return { handled: true, trigger: envelope.triggerEvent }
						default:
							yield* Effect.logInfo('Unhandled cal.com trigger').pipe(
								Effect.annotateLogs({
									event: 'calcom.webhook.ignored',
									trigger: envelope.triggerEvent,
								}),
							)
							return { handled: false, trigger: envelope.triggerEvent }
					}
				})

			const ingestCalcomBooking = (
				payload: CalcomWebhookPayload,
				status: 'confirmed' | 'tentative',
			) =>
				sql.withTransaction(
					Effect.gen(function* () {
						if (!payload.iCalUID || !payload.startTime || !payload.endTime) {
							return yield* Effect.logWarning(
								'cal.com booking missing required fields',
							).pipe(
								Effect.annotateLogs({
									event: 'calcom.webhook.malformed',
									hasIcalUid: Boolean(payload.iCalUID),
								}),
							)
						}
						const startAt = new Date(payload.startTime)
						const endAt = new Date(payload.endTime)
						const organizerEmail =
							payload.organizer?.email?.toLowerCase() ?? 'unknown@calendar'
						const providerBookingId =
							payload.uid ?? String(payload.bookingId ?? payload.iCalUID)
						const eventType = yield* loadEventType(
							payload.eventTypeId ? String(payload.eventTypeId) : null,
						)
						const owner =
							payload.attendees && payload.attendees.length > 0
								? yield* inferEventOwner(
										payload.attendees.map(a => ({
											email: a.email,
											name: a.name ?? null,
											rsvp: 'needs-action' as const,
											isOrganizer: false,
										})),
									)
								: { companyId: null, contactId: null }
						const locationType: CalendarLocationType = payload.location
							? payload.location.startsWith('http')
								? 'video'
								: 'address'
							: 'none'
						const row = yield* upsertEventFromBooking({
							icalUid: payload.iCalUID,
							icalSequence: payload.iCalSequence ?? 0,
							providerBookingId,
							provider: 'calcom',
							eventTypeId: eventType?.id ?? null,
							startAt,
							endAt,
							status,
							title: payload.title ?? '(untitled)',
							locationType,
							locationValue: payload.location ?? null,
							videoCallUrl:
								payload.location && payload.location.startsWith('http')
									? payload.location
									: null,
							organizerEmail,
							companyId: owner.companyId,
							contactId: owner.contactId,
							metadata: payload.metadata ?? null,
						})
						if (!row) return

						yield* upsertAttendees(
							row.id,
							(payload.attendees ?? []).map(a => ({
								email: a.email,
								name: a.name ?? null,
								rsvp: 'needs-action' as const,
								isOrganizer: false,
							})),
						)
						if (organizerEmail !== 'unknown@calendar') {
							yield* upsertAttendees(row.id, [
								{
									email: organizerEmail,
									name: payload.organizer?.name ?? null,
									rsvp: 'accepted',
									isOrganizer: true,
								},
							])
						}

						// Tentative bookings don't bump `next_calendar_event_at`
						// (awaiting confirmation); only confirmed ones fire.
						if (status === 'confirmed') {
							yield* timeline.record(
								new MeetingScheduled({
									calendarEventId: row.id,
									companyId: owner.companyId,
									contactId: owner.contactId,
									source: 'booking',
									title: row.title,
									startAt,
									endAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
						}
					}),
				)

			const ingestCalcomReschedule = (payload: CalcomWebhookPayload) =>
				sql.withTransaction(
					Effect.gen(function* () {
						if (!payload.iCalUID || !payload.startTime || !payload.endTime)
							return
						const existing = yield* findByIcalUid(payload.iCalUID)
						if (!existing) {
							// Treat as a first-time insert; cal.com sometimes
							// delivers RESCHEDULE before CREATED on edge retries.
							yield* ingestCalcomBooking(payload, 'confirmed')
							return
						}
						const previousStartAt = existing.startAt
						const startAt = new Date(payload.startTime)
						const endAt = new Date(payload.endTime)
						yield* sql`
							UPDATE calendar_events SET
								start_at = ${startAt},
								end_at = ${endAt},
								ical_sequence = GREATEST(ical_sequence, ${payload.iCalSequence ?? existing.icalSequence + 1}),
								status = 'confirmed',
								updated_at = now()
							WHERE ical_uid = ${payload.iCalUID}
						`
						yield* timeline.record(
							new MeetingRescheduled({
								calendarEventId: existing.id,
								companyId: existing.companyId,
								contactId: existing.contactId,
								previousStartAt,
								startAt,
								endAt,
								actorUserId: null,
								occurredAt: new Date(),
							}),
						)
					}),
				)

			const ingestCalcomCancel = (payload: CalcomWebhookPayload) =>
				sql.withTransaction(
					Effect.gen(function* () {
						if (!payload.iCalUID) return
						const existing = yield* findByIcalUid(payload.iCalUID)
						const row = yield* markCancelled(
							payload.iCalUID,
							payload.iCalSequence ?? (existing?.icalSequence ?? 0) + 1,
						)
						const target = row ?? existing
						if (!target) return
						yield* timeline.record(
							new MeetingCancelled({
								calendarEventId: target.id,
								companyId: target.companyId,
								contactId: target.contactId,
								cancelledStartAt: target.startAt,
								actorUserId: null,
								occurredAt: new Date(),
							}),
						)
					}),
				)

			// MEETING_ENDED fires when a cal.com meeting wraps up. We create
			// a follow-up task so the human + agent queue surfaces it next
			// time they open /tasks.
			const handleMeetingEnded = (payload: CalcomWebhookPayload) =>
				sql.withTransaction(
					Effect.gen(function* () {
						if (!payload.iCalUID) return
						const existing = yield* findByIcalUid(payload.iCalUID)
						if (!existing || !existing.companyId) return
						const dueAt = new Date(
							existing.endAt.getTime() + 24 * 60 * 60 * 1000,
						)
						yield* sql`
							INSERT INTO tasks ${sql.insert({
								companyId: existing.companyId,
								contactId: existing.contactId,
								type: 'followup',
								title: `Follow up after: ${existing.title}`,
								source: 'booking',
								priority: 'normal',
								status: 'open',
								linkedCalendarEventId: existing.id,
								dueAt,
							})}
						`
					}),
				)

			// ── ICS ingest (email-sourced) ─────────────────────────────
			const ingestIcs = (args: {
				readonly rawIcs: Uint8Array
				readonly sourceEmailMessageId: string | null
			}) =>
				Effect.gen(function* () {
					const parsed = yield* parser.parse(args.rawIcs)
					const results: {
						created: number
						updated: number
						cancelled: number
						rsvpUpdated: number
					} = { created: 0, updated: 0, cancelled: 0, rsvpUpdated: 0 }
					for (const vevent of parsed.events) {
						yield* applyParsedVEvent({
							parsed,
							vevent,
							rawIcs: args.rawIcs,
							sourceEmailMessageId: args.sourceEmailMessageId,
							results,
						})
					}
					return results
				})

			const applyParsedVEvent = (args: {
				readonly parsed: ParsedIcs
				readonly vevent: ParsedIcs['events'][number]
				readonly rawIcs: Uint8Array
				readonly sourceEmailMessageId: string | null
				readonly results: {
					created: number
					updated: number
					cancelled: number
					rsvpUpdated: number
				}
			}) =>
				sql.withTransaction(
					Effect.gen(function* () {
						const { parsed, vevent, rawIcs, results } = args
						if (parsed.method === 'REPLY') {
							const row = yield* findByIcalUid(vevent.icalUid)
							if (!row) return
							const replyAttendee = vevent.attendees[0]
							if (!replyAttendee) return
							yield* sql`
								UPDATE calendar_event_attendees SET
									rsvp = ${replyAttendee.rsvp},
									updated_at = now()
								WHERE event_id = ${row.id}
									AND lower(email) = ${replyAttendee.email.toLowerCase()}
							`
							if (
								replyAttendee.rsvp === 'accepted' ||
								replyAttendee.rsvp === 'declined' ||
								replyAttendee.rsvp === 'tentative'
							) {
								yield* timeline.record(
									new MeetingRsvp({
										calendarEventId: row.id,
										attendeeEmail: replyAttendee.email.toLowerCase(),
										rsvp: replyAttendee.rsvp,
										companyId: row.companyId,
										contactId: row.contactId,
										actorUserId: null,
										occurredAt: new Date(),
									}),
								)
							}
							results.rsvpUpdated += 1
							return
						}

						const existing = yield* findByIcalUid(vevent.icalUid)
						if (existing && existing.icalSequence > vevent.icalSequence) return

						const owner = yield* inferEventOwner(vevent.attendees)
						const finalStatus =
							parsed.method === 'CANCEL' ? 'cancelled' : vevent.status

						const inserted = yield* sql<CalendarEventRow>`
							INSERT INTO calendar_events ${sql.insert({
								source: 'email',
								provider: 'email',
								providerBookingId: null,
								icalUid: vevent.icalUid,
								icalSequence: vevent.icalSequence,
								eventTypeId: null,
								startAt: vevent.startAt,
								endAt: vevent.endAt,
								status: finalStatus,
								title: vevent.title,
								locationType: vevent.locationType,
								locationValue: vevent.locationValue,
								videoCallUrl: vevent.videoCallUrl,
								organizerEmail: vevent.organizerEmail,
								companyId: owner.companyId,
								contactId: owner.contactId,
								interactionId: null,
								metadata: JSON.stringify({
									...vevent.metadata,
									...(args.sourceEmailMessageId
										? { sourceEmailMessageId: args.sourceEmailMessageId }
										: {}),
								}),
								rawIcs,
							})}
							ON CONFLICT (ical_uid) DO UPDATE SET
								ical_sequence = EXCLUDED.ical_sequence,
								start_at = EXCLUDED.start_at,
								end_at = EXCLUDED.end_at,
								status = EXCLUDED.status,
								title = EXCLUDED.title,
								location_type = EXCLUDED.location_type,
								location_value = EXCLUDED.location_value,
								video_call_url = EXCLUDED.video_call_url,
								metadata = EXCLUDED.metadata,
								updated_at = now()
							WHERE calendar_events.ical_sequence <= EXCLUDED.ical_sequence
							RETURNING *
						`.pipe(Effect.map(rows => rows[0] ?? null))

						if (!inserted) return

						yield* upsertAttendees(
							inserted.id,
							vevent.attendees.map(a => ({
								email: a.email,
								name: a.name,
								rsvp: a.rsvp,
								isOrganizer: a.isOrganizer,
							})),
						)

						if (parsed.method === 'CANCEL') {
							yield* timeline.record(
								new MeetingCancelled({
									calendarEventId: inserted.id,
									companyId: inserted.companyId,
									contactId: inserted.contactId,
									cancelledStartAt: inserted.startAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
							results.cancelled += 1
							return
						}

						if (existing) {
							yield* timeline.record(
								new MeetingRescheduled({
									calendarEventId: inserted.id,
									companyId: inserted.companyId,
									contactId: inserted.contactId,
									previousStartAt: existing.startAt,
									startAt: inserted.startAt,
									endAt: inserted.endAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
							results.updated += 1
						} else {
							yield* timeline.record(
								new MeetingScheduled({
									calendarEventId: inserted.id,
									companyId: inserted.companyId,
									contactId: inserted.contactId,
									source: 'email',
									title: inserted.title,
									startAt: inserted.startAt,
									endAt: inserted.endAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
							results.created += 1
						}
					}),
				)

			// ── Booking operations (MCP-facing) ────────────────────────
			const scheduleMeeting = (args: {
				readonly eventTypeId: string
				readonly startAt: Date
				readonly attendees: ReadonlyArray<{
					readonly email: string
					readonly name: string | null
				}>
				readonly companyId: string | null
				readonly contactId: string | null
				readonly organizerEmail: string
				readonly metadata: Record<string, unknown> | null
			}) =>
				Effect.gen(function* () {
					const eventType = yield* loadEventTypeById(args.eventTypeId)
					if (!eventType || !eventType.providerEventTypeId) {
						return yield* Effect.fail(
							new BookingFailed({
								provider: 'calendar-service',
								reason: 'unknown_event_type_or_not_synced',
								recoverable: false,
							}),
						)
					}
					const ref = yield* provider.createBooking({
						providerEventTypeId: eventType.providerEventTypeId,
						startAt: args.startAt,
						attendees: args.attendees,
						metadata: args.metadata,
					})
					const endAt = new Date(
						args.startAt.getTime() + eventType.durationMinutes * 60 * 1000,
					)
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							const row = yield* upsertEventFromBooking({
								icalUid: ref.icalUid,
								icalSequence: ref.icalSequence,
								providerBookingId: ref.providerBookingId,
								provider: ref.provider === 'internal' ? 'calcom' : ref.provider,
								eventTypeId: eventType.id,
								startAt: args.startAt,
								endAt,
								status: 'confirmed',
								title: eventType.slug,
								locationType: 'video',
								locationValue: null,
								videoCallUrl: null,
								organizerEmail: args.organizerEmail.toLowerCase(),
								companyId: args.companyId,
								contactId: args.contactId,
								metadata: args.metadata,
							})
							if (!row) {
								return yield* Effect.die(
									new Error('scheduleMeeting upsert returned no row'),
								)
							}
							yield* upsertAttendees(
								row.id,
								args.attendees.map(a => ({
									email: a.email,
									name: a.name,
									rsvp: 'needs-action' as const,
									isOrganizer: false,
								})),
							)
							yield* upsertAttendees(row.id, [
								{
									email: args.organizerEmail.toLowerCase(),
									name: null,
									rsvp: 'accepted',
									isOrganizer: true,
								},
							])
							yield* timeline.record(
								new MeetingScheduled({
									calendarEventId: row.id,
									companyId: args.companyId,
									contactId: args.contactId,
									source: 'booking',
									title: row.title,
									startAt: args.startAt,
									endAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
							return row
						}),
					)
				})

			const rescheduleMeeting = (args: {
				readonly calendarEventId: string
				readonly newStartAt: Date
			}) =>
				Effect.gen(function* () {
					const existing = yield* findById(args.calendarEventId)
					if (!existing) {
						return yield* Effect.fail(
							new CalendarEventNotFound({
								calendarEventId: args.calendarEventId,
							}),
						)
					}
					if (existing.source !== 'booking' || !existing.providerBookingId) {
						return yield* Effect.fail(
							new InvalidRsvpTarget({
								calendarEventId: args.calendarEventId,
								reason: 'reschedule_only_for_booking_source',
							}),
						)
					}
					const ref = yield* provider.rescheduleBooking(
						existing.providerBookingId,
						args.newStartAt,
					)
					const duration = existing.endAt.getTime() - existing.startAt.getTime()
					const newEndAt = new Date(args.newStartAt.getTime() + duration)
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`
								UPDATE calendar_events SET
									start_at = ${args.newStartAt},
									end_at = ${newEndAt},
									ical_sequence = ${ref.icalSequence},
									updated_at = now()
								WHERE id = ${existing.id}
							`
							yield* timeline.record(
								new MeetingRescheduled({
									calendarEventId: existing.id,
									companyId: existing.companyId,
									contactId: existing.contactId,
									previousStartAt: existing.startAt,
									startAt: args.newStartAt,
									endAt: newEndAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
							return { ...existing, startAt: args.newStartAt, endAt: newEndAt }
						}),
					)
				})

			const cancelMeeting = (args: {
				readonly calendarEventId: string
				readonly reason: string | null
			}) =>
				Effect.gen(function* () {
					const existing = yield* findById(args.calendarEventId)
					if (!existing) {
						return yield* Effect.fail(
							new CalendarEventNotFound({
								calendarEventId: args.calendarEventId,
							}),
						)
					}
					if (existing.source === 'booking' && existing.providerBookingId) {
						yield* provider.cancelBooking(
							existing.providerBookingId,
							args.reason,
						)
					}
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`
								UPDATE calendar_events SET
									status = 'cancelled',
									updated_at = now()
								WHERE id = ${existing.id}
							`
							yield* timeline.record(
								new MeetingCancelled({
									calendarEventId: existing.id,
									companyId: existing.companyId,
									contactId: existing.contactId,
									cancelledStartAt: existing.startAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
							return { ...existing, status: 'cancelled' as const }
						}),
					)
				})

			// Central RSVP dispatcher used by both the Batuda drawer and the
			// `respond_to_invitation` MCP tool. Source decides the outbound
			// path: booking → provider call; email → REPLY ICS; internal → 409.
			const respondToRsvp = (args: {
				readonly calendarEventId: string
				readonly attendeeEmail: string
				readonly rsvp: CalendarAttendeeRsvp
				readonly comment: string | null
				readonly actorUserId: string | null
			}) =>
				Effect.gen(function* () {
					const existing = yield* findById(args.calendarEventId)
					if (!existing) {
						return yield* Effect.fail(
							new CalendarEventNotFound({
								calendarEventId: args.calendarEventId,
							}),
						)
					}
					if (existing.source === 'internal') {
						return yield* Effect.fail(
							new InvalidRsvpTarget({
								calendarEventId: args.calendarEventId,
								reason: 'internal_events_have_no_attendees',
							}),
						)
					}
					const attendeeEmail = args.attendeeEmail.toLowerCase()

					if (args.rsvp === 'needs-action') {
						return yield* Effect.fail(
							new InvalidRsvpTarget({
								calendarEventId: args.calendarEventId,
								reason: 'needs_action_is_not_a_user_choice',
							}),
						)
					}
					const rsvp: 'accepted' | 'declined' | 'tentative' = args.rsvp

					// Refuse RSVPs from emails that aren't on the stored attendee
					// list — without this, a caller could forge a reply for any
					// email it picks. Tagged distinctly so callers can map to 403.
					const attendeeMatch = yield* sql<{ exists: boolean }>`
						SELECT EXISTS (
							SELECT 1 FROM calendar_event_attendees
							WHERE event_id = ${existing.id}
								AND lower(email) = ${attendeeEmail}
						) AS exists
					`
					if (!attendeeMatch[0]?.exists) {
						return yield* Effect.fail(
							new CannotRsvpForSomeoneElse({
								calendarEventId: args.calendarEventId,
								attendeeEmail,
								requestedBy: args.actorUserId ?? 'unknown',
							}),
						)
					}

					let replyBytes: Uint8Array | null = null
					if (existing.source === 'email' && existing.rawIcs) {
						replyBytes = yield* parser
							.buildReply({
								originalIcs: existing.rawIcs,
								attendeeEmail,
								rsvp,
							})
							.pipe(
								Effect.catchTag('InvalidIcs', () =>
									Effect.succeed<Uint8Array | null>(null),
								),
							)
					} else if (
						existing.source === 'booking' &&
						existing.providerBookingId
					) {
						yield* provider
							.respondToRsvp({
								providerBookingId: existing.providerBookingId,
								rsvp,
								comment: args.comment,
							})
							.pipe(
								Effect.catchTag(
									'UnsupportedRsvp',
									() =>
										// Booking provider can't accept 'tentative' — keep
										// the local row state, skip the upstream round-trip.
										Effect.void,
								),
							)
					}

					return yield* sql.withTransaction(
						Effect.gen(function* () {
							const attendees = yield* sql<{ id: string; email: string }>`
								UPDATE calendar_event_attendees SET
									rsvp = ${rsvp},
									updated_at = now()
								WHERE event_id = ${existing.id}
									AND lower(email) = ${attendeeEmail}
								RETURNING id, email
							`
							yield* timeline.record(
								new MeetingRsvp({
									calendarEventId: existing.id,
									attendeeEmail,
									rsvp,
									companyId: existing.companyId,
									contactId: existing.contactId,
									actorUserId: args.actorUserId,
									occurredAt: new Date(),
								}),
							)
							return {
								updated: attendees.length,
								rsvp,
								replyIcs: replyBytes,
							}
						}),
					)
				})

			const syncEventTypes = () =>
				Effect.gen(function* () {
					const upstream = yield* provider.listEventTypes()
					for (const ref of upstream) {
						if (!ref.providerEventTypeId) continue
						yield* sql`
							UPDATE calendar_event_types SET
								title = ${ref.title},
								duration_minutes = ${ref.durationMinutes},
								location_kind = ${ref.locationKind},
								default_location_value = ${ref.defaultLocationValue},
								active = ${ref.active},
								synced_at = now(),
								updated_at = now()
							WHERE provider = ${ref.provider}
								AND provider_event_type_id = ${ref.providerEventTypeId}
						`
					}
					return { synced: upstream.length }
				})

			const createInternalBlock = (args: {
				readonly title: string
				readonly startAt: Date
				readonly endAt: Date
				readonly organizerEmail: string
				readonly locationType: CalendarLocationType
				readonly locationValue: string | null
				readonly companyId: string | null
				readonly contactId: string | null
				readonly metadata: Record<string, unknown> | null
			}) =>
				Effect.gen(function* () {
					const icalUid = `internal-${crypto.randomUUID()}@calendar.batuda`
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							const rows = yield* sql<CalendarEventRow>`
								INSERT INTO calendar_events ${sql.insert({
									source: 'internal',
									provider: 'internal',
									providerBookingId: null,
									icalUid,
									icalSequence: 0,
									eventTypeId: null,
									startAt: args.startAt,
									endAt: args.endAt,
									status: 'confirmed',
									title: args.title,
									locationType: args.locationType,
									locationValue: args.locationValue,
									videoCallUrl: null,
									organizerEmail: args.organizerEmail.toLowerCase(),
									companyId: args.companyId,
									contactId: args.contactId,
									interactionId: null,
									metadata: args.metadata
										? JSON.stringify(args.metadata)
										: null,
									rawIcs: null,
								})}
								RETURNING *
							`
							const row = rows[0]
							if (!row) {
								return yield* Effect.die(
									new Error('createInternalBlock insert returned no row'),
								)
							}
							yield* timeline.record(
								new MeetingScheduled({
									calendarEventId: row.id,
									companyId: args.companyId,
									contactId: args.contactId,
									source: 'internal',
									title: args.title,
									startAt: args.startAt,
									endAt: args.endAt,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
							return row
						}),
					)
				})

			// Rebuilds a METHOD=REQUEST ICS from scratch so forwarding an
			// invitation to a new attendee shares the same `UID` — downstream
			// inboxes dedup the event against their original copy.
			const forwardInvitation = (args: {
				readonly calendarEventId: string
				readonly toEmail: string
				readonly note: string | null
			}) =>
				Effect.gen(function* () {
					const existing = yield* findById(args.calendarEventId)
					if (!existing) {
						return yield* Effect.fail(
							new CalendarEventNotFound({
								calendarEventId: args.calendarEventId,
							}),
						)
					}
					if (existing.status === 'cancelled') {
						return yield* Effect.fail(
							new InvalidRsvpTarget({
								calendarEventId: args.calendarEventId,
								reason: 'cannot_forward_cancelled_invitation',
							}),
						)
					}
					const formatIcsDate = (d: Date) =>
						d
							.toISOString()
							.replace(/[-:]/g, '')
							.replace(/\.\d{3}/, '')
					// RFC 5545 §3.3.11: TEXT values must escape `\`, `;`, `,`,
					// and newlines. Titles with commas ("Sync w/ Marta, Joan")
					// would otherwise break the property at the first comma.
					const escapeIcsText = (s: string) =>
						s
							.replace(/\\/g, '\\\\')
							.replace(/;/g, '\\;')
							.replace(/,/g, '\\,')
							.replace(/\r\n|\r|\n/g, '\\n')
					// RFC 5545 §3.8.7.2: every VEVENT MUST carry a DTSTAMP
					// (creation time of the ICS in UTC). Without it strict
					// parsers (Outlook, Exchange) reject the envelope.
					const dtStamp = formatIcsDate(new Date())
					const ics = [
						'BEGIN:VCALENDAR',
						'VERSION:2.0',
						'PRODID:-//Batuda//Calendar//EN',
						'METHOD:REQUEST',
						'BEGIN:VEVENT',
						`UID:${existing.icalUid}`,
						`SEQUENCE:${existing.icalSequence}`,
						`DTSTAMP:${dtStamp}`,
						`DTSTART:${formatIcsDate(existing.startAt)}`,
						`DTEND:${formatIcsDate(existing.endAt)}`,
						`SUMMARY:${escapeIcsText(existing.title)}`,
						`ORGANIZER:MAILTO:${existing.organizerEmail}`,
						`ATTENDEE;PARTSTAT=NEEDS-ACTION:MAILTO:${args.toEmail.toLowerCase()}`,
						'END:VEVENT',
						'END:VCALENDAR',
						'',
					].join('\r\n')
					return { ics: new TextEncoder().encode(ics) }
				})

			// ── Read helpers ───────────────────────────────────────────
			const findAvailability = (args: {
				readonly eventTypeId: string
				readonly from: Date
				readonly to: Date
			}) =>
				Effect.gen(function* () {
					const eventType = yield* loadEventTypeById(args.eventTypeId)
					if (!eventType || !eventType.providerEventTypeId) {
						return yield* Effect.fail(
							new BookingFailed({
								provider: 'calendar-service',
								reason: 'unknown_event_type_or_not_synced',
								recoverable: false,
							}),
						)
					}
					const key = cacheKey(
						eventType.providerEventTypeId,
						args.from,
						args.to,
					)
					const hit = slotCache.get(key)
					if (hit && hit.expiresAt > Date.now()) return hit.slots
					const slots = yield* provider
						.findSlots({
							providerEventTypeId: eventType.providerEventTypeId,
							from: args.from,
							to: args.to,
						})
						.pipe(
							Effect.catchTag('NoAvailability', () =>
								Effect.succeed<ReadonlyArray<Slot>>([]),
							),
						)
					slotCache.set(key, {
						slots,
						expiresAt: Date.now() + AVAILABILITY_CACHE_TTL_MS,
					})
					return slots
				})

			// Pending RSVP surface for `rsvp_pending_invitations`. We scope
			// the query to the attendee email so an agent can ask "what am
			// I still on the hook for?" without a contact walkback.
			const listPendingInvitations = (args: {
				readonly attendeeEmail: string
				readonly limit: number
			}) =>
				sql`
					SELECT e.*, a.rsvp AS attendee_rsvp
					FROM calendar_events e
					JOIN calendar_event_attendees a ON a.event_id = e.id
					WHERE lower(a.email) = ${args.attendeeEmail.toLowerCase()}
						AND a.rsvp = 'needs-action'
						AND e.start_at > now()
						AND e.status <> 'cancelled'
					ORDER BY e.start_at ASC
					LIMIT ${args.limit}
				`

			return {
				handleCalcomWebhook,
				findAvailability,
				scheduleMeeting,
				rescheduleMeeting,
				cancelMeeting,
				respondToRsvp,
				syncEventTypes,
				createInternalBlock,
				forwardInvitation,
				ingestIcs,
				listPendingInvitations,
				findById: (id: string) =>
					findById(id).pipe(
						Effect.flatMap(row =>
							row
								? Effect.succeed(row)
								: Effect.fail(
										new CalendarEventNotFound({ calendarEventId: id }),
									),
						),
					),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}

// Re-exports for callers that need the port errors in catch-tags.
export {
	BookingFailed,
	BookingProvider,
	IcsParser,
	InvalidIcs,
	NoAvailability,
	UnsupportedRsvp,
}
