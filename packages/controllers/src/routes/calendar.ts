import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { CalendarLocationType } from '@batuda/calendar'

import { BadRequest, Conflict, Forbidden, NotFound } from '../errors'
import { SessionMiddleware } from '../middleware/session'

// ── Input schemas ──

// Internal work block: no provider booking, no attendees. The server
// generates an `ical_uid` locally so future CalDAV export is a no-op.
export const CreateInternalEventInput = Schema.Struct({
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	startAt: Schema.DateTimeUtc,
	endAt: Schema.DateTimeUtc,
	locationType: Schema.optional(CalendarLocationType),
	locationValue: Schema.optional(Schema.NullOr(Schema.String)),
	companyId: Schema.optional(Schema.NullOr(Schema.String)),
	contactId: Schema.optional(Schema.NullOr(Schema.String)),
	metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
})

// RSVP on an email-sourced event generates a METHOD=REPLY ICS and sends
// it back to the organizer via the existing email-reply path. `comment`
// becomes a free-text note appended to the reply body. Only the three
// action literals — `needs-action` is the initial state, not something
// a caller can send.
export const RsvpEventInput = Schema.Struct({
	rsvp: Schema.Literals(['accepted', 'declined', 'tentative']),
	comment: Schema.optional(Schema.String),
})

// ── Route group ──

export const CalendarGroup = HttpApiGroup.make('calendar')
	.add(
		HttpApiEndpoint.get('listEventTypes', '/calendar/event-types', {
			query: {
				active: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('syncEventTypes', '/calendar/event-types/sync', {
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('listEvents', '/calendar/events', {
			query: {
				from: Schema.optional(Schema.String),
				to: Schema.optional(Schema.String),
				companyId: Schema.optional(Schema.String),
				contactId: Schema.optional(Schema.String),
				source: Schema.optional(Schema.String),
				status: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('getEvent', '/calendar/events/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('createInternalEvent', '/calendar/events', {
			payload: CreateInternalEventInput,
			success: Schema.Unknown,
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}),
	)
	.add(
		HttpApiEndpoint.post('rsvpEvent', '/calendar/events/:id/rsvp', {
			params: { id: Schema.String },
			payload: RsvpEventInput,
			success: Schema.Unknown,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
				Forbidden.pipe(HttpApiSchema.status(403)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.get('availability', '/calendar/availability', {
			query: {
				eventTypeId: Schema.String,
				from: Schema.String,
				to: Schema.String,
			},
			success: Schema.Array(Schema.Unknown),
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
