import { Cache, DateTime, Duration, Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BookingProvider } from '@batuda/calendar'
import {
	BadRequest,
	BatudaApi,
	Conflict,
	Forbidden,
	NotFound,
	SessionContext,
} from '@batuda/controllers'

import { dispatchRsvpReply } from '../services/calendar-rsvp-dispatch.js'

type EventTypeRow = {
	readonly id: string
	readonly slug: string
	readonly provider_event_type_id: string | null
}

type EventRow = {
	readonly id: string
	readonly source: 'booking' | 'email' | 'internal'
}

const cacheKey = (eventTypeId: string, from: string, to: string) =>
	`${eventTypeId}|${from}|${to}`

export const CalendarLive = HttpApiBuilder.group(
	BatudaApi,
	'calendar',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const provider = yield* BookingProvider

			// Remembers the available times we just looked up so the booking
			// picker stays fast while someone clicks around, instead of asking
			// the calendar provider again and again. We keep the 500 most recent
			// answers and forget each one after a minute, so this memory can't
			// grow forever.
			const slotCache = yield* Cache.make<
				string,
				ReadonlyArray<unknown>,
				never,
				never
			>({
				capacity: 500,
				timeToLive: Duration.seconds(60),
				// We always store answers ourselves; we never ask this cache to
				// fetch one for us, so reaching here means something went wrong.
				lookup: () =>
					Effect.die('calendar slotCache lookup invoked — expected set-only'),
			})

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
						const { userId, email: attendeeEmail } = yield* SessionContext
						const result = yield* dispatchRsvpReply({
							calendarEventId: _.params.id,
							attendeeEmail,
							rsvp: _.payload.rsvp,
							comment: _.payload.comment ?? null,
							actorUserId: userId,
						})
						return {
							updated: result.updated,
							rsvp: result.rsvp,
						}
					}).pipe(
						Effect.catchTag('CalendarEventNotFound', e =>
							Effect.fail(
								new NotFound({
									entity: 'calendar_event',
									id: e.calendarEventId,
								}),
							),
						),
						Effect.catchTag('InvalidRsvpTarget', e =>
							Effect.fail(new Conflict({ message: e.reason })),
						),
						Effect.catchTag('CannotRsvpForSomeoneElse', () =>
							Effect.fail(
								new Forbidden({
									message: 'cannot_rsvp_for_someone_else',
								}),
							),
						),
						Effect.catch(e =>
							e._tag === 'NotFound' ||
							e._tag === 'Conflict' ||
							e._tag === 'Forbidden'
								? Effect.fail(e)
								: Effect.die(e),
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
						const cached = yield* Cache.getOption(slotCache, key)
						if (Option.isSome(cached)) return cached.value

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
						yield* Cache.set(slotCache, key, slots)
						return slots
					}).pipe(
						Effect.catch(e =>
							e._tag === 'BadRequest' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
		}),
)
