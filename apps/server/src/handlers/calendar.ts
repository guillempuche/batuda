import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BookingProvider } from '@batuda/calendar'
import {
	BadRequest,
	BatudaApi,
	NotFound,
	SessionContext,
} from '@batuda/controllers'

type EventTypeRow = {
	readonly id: string
	readonly slug: string
	readonly provider_event_type_id: string | null
}

type EventRow = {
	readonly id: string
	readonly source: 'booking' | 'email' | 'internal'
}

// Hard-coded 60s availability cache per `(eventTypeId, from, to)`. A
// request that arrives inside the window replays the prior slot list
// so the Batuda booking picker doesn't fan out N parallel calls into
// the provider when the user clicks around. The entry is invalidated
// by a booking webhook fan-out; in between, the provider's own edge
// staleness is already bounded.
const slotCache = new Map<
	string,
	{ readonly expiresAt: number; readonly slots: ReadonlyArray<unknown> }
>()
const cacheKey = (eventTypeId: string, from: string, to: string) =>
	`${eventTypeId}|${from}|${to}`

export const CalendarLive = HttpApiBuilder.group(
	BatudaApi,
	'calendar',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const provider = yield* BookingProvider
			return handlers
				.handle('listEventTypes', _ =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (_.query.active === 'true') conditions.push(sql`active = true`)
						else if (_.query.active === 'false')
							conditions.push(sql`active = false`)
						return yield* sql`
							SELECT * FROM calendar_event_types
							${conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``}
							ORDER BY slug
						`
					}).pipe(Effect.orDie),
				)
				.handle('syncEventTypes', () =>
					Effect.gen(function* () {
						const upstream = yield* provider.listEventTypes()
						for (const ref of upstream) {
							yield* sql`
								UPDATE calendar_event_types SET
									provider_event_type_id = ${ref.providerEventTypeId},
									synced_at = now(),
									updated_at = now()
								WHERE provider = ${ref.provider}
									AND provider_event_type_id = ${ref.providerEventTypeId}
							`
						}
						return { synced: upstream.length }
					}).pipe(Effect.orDie),
				)
				.handle('listEvents', _ =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (_.query.from) conditions.push(sql`start_at >= ${_.query.from}`)
						if (_.query.to) conditions.push(sql`start_at <= ${_.query.to}`)
						if (_.query.companyId)
							conditions.push(sql`company_id = ${_.query.companyId}`)
						if (_.query.contactId)
							conditions.push(sql`contact_id = ${_.query.contactId}`)
						if (_.query.source) conditions.push(sql`source = ${_.query.source}`)
						if (_.query.status) conditions.push(sql`status = ${_.query.status}`)
						const limit = _.query.limit ?? 100
						const offset = _.query.offset ?? 0
						return yield* sql`
							SELECT * FROM calendar_events
							${conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``}
							ORDER BY start_at ASC
							LIMIT ${limit} OFFSET ${offset}
						`
					}).pipe(Effect.orDie),
				)
				.handle('getEvent', _ =>
					Effect.gen(function* () {
						const rows = yield* sql<EventRow>`
							SELECT * FROM calendar_events WHERE id = ${_.params.id} LIMIT 1
						`
						if (rows.length === 0)
							return yield* new NotFound({
								entity: 'calendar_event',
								id: _.params.id,
							})
						return rows[0]
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('createInternalEvent', _ =>
					Effect.gen(function* () {
						const { email: organizerEmail } = yield* SessionContext
						const startAt = DateTime.toDateUtc(_.payload.startAt)
						const endAt = DateTime.toDateUtc(_.payload.endAt)
						if (endAt.getTime() <= startAt.getTime())
							return yield* new BadRequest({
								message: 'endAt_must_be_after_startAt',
							})
						// Locally-generated UID so future CalDAV export is a no-op.
						const icalUid = `internal-${crypto.randomUUID()}@calendar.batuda`
						const rows = yield* sql`
							INSERT INTO calendar_events ${sql.insert({
								source: 'internal',
								provider: 'internal',
								provider_booking_id: null,
								ical_uid: icalUid,
								ical_sequence: 0,
								event_type_id: null,
								start_at: startAt,
								end_at: endAt,
								status: 'confirmed',
								title: _.payload.title,
								location_type: _.payload.locationType ?? 'none',
								location_value: _.payload.locationValue ?? null,
								video_call_url: null,
								organizer_email: organizerEmail,
								company_id: _.payload.companyId ?? null,
								contact_id: _.payload.contactId ?? null,
								interaction_id: null,
								metadata: _.payload.metadata ?? null,
								raw_ics: null,
							})} RETURNING *
						`
						return rows[0]
					}).pipe(
						Effect.catch(e =>
							e._tag === 'BadRequest' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('rsvpEvent', _ =>
					Effect.gen(function* () {
						// Minimal scaffold: update the primary attendee's RSVP column.
						// The full flow (build REPLY ICS for source='email', call
						// provider.respondToRsvp for source='booking') lands with the
						// CalendarService in a later PR.
						const { email: attendeeEmail } = yield* SessionContext
						const exists = yield* sql<EventRow>`
							SELECT * FROM calendar_events WHERE id = ${_.params.id} LIMIT 1
						`
						if (exists.length === 0)
							return yield* new NotFound({
								entity: 'calendar_event',
								id: _.params.id,
							})
						const rows = yield* sql`
							UPDATE calendar_event_attendees SET
								rsvp = ${_.payload.rsvp},
								updated_at = now()
							WHERE event_id = ${_.params.id}
								AND lower(email) = lower(${attendeeEmail})
							RETURNING *
						`
						return { updated: rows.length, rsvp: _.payload.rsvp }
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('availability', _ =>
					Effect.gen(function* () {
						// Resolve slug → (provider, providerEventTypeId) because the
						// port speaks provider-native ids, while the query exposes our
						// local event-type id.
						const types = yield* sql<EventTypeRow>`
							SELECT id, slug, provider_event_type_id
							FROM calendar_event_types
							WHERE id = ${_.query.eventTypeId}
							LIMIT 1
						`
						if (types.length === 0 || !types[0]!.provider_event_type_id)
							return yield* new BadRequest({
								message: 'unknown_event_type_or_not_synced',
							})
						const key = cacheKey(_.query.eventTypeId, _.query.from, _.query.to)
						const cached = slotCache.get(key)
						if (cached && cached.expiresAt > Date.now()) return cached.slots

						const slots = yield* provider
							.findSlots({
								providerEventTypeId: types[0]!.provider_event_type_id,
								from: new Date(_.query.from),
								to: new Date(_.query.to),
							})
							.pipe(
								Effect.catchTag('NoAvailability', () =>
									Effect.succeed<ReadonlyArray<unknown>>([]),
								),
								Effect.catchTag('BookingFailed', () =>
									Effect.die('provider_failed'),
								),
							)
						slotCache.set(key, {
							slots,
							expiresAt: Date.now() + 60_000,
						})
						return slots
					}).pipe(
						Effect.catch(e =>
							e._tag === 'BadRequest' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
		}),
)
