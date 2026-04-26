import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, SessionContext } from '@batuda/controllers'

import { CalendarService } from '../../services/calendar'
import { dispatchForwardInvitation } from '../../services/calendar-forward-dispatch'
import { dispatchRsvpReply } from '../../services/calendar-rsvp-dispatch'
import { EmailService } from '../../services/email'

// Per-request services the dispatcher tools depend on. The MCP HTTP middleware
// (apps/server/src/mcp/http.ts) provides both alongside CurrentUser, so
// declaring them here lets the toolkit's static check see them as
// satisfied requirements rather than free `R` channels.
const REQUEST_DEPENDENCIES = [SessionContext, CurrentOrg]

// Agents identify the attendee at the protocol boundary (no session
// ambient state to reach into) — the primary user's email rides with
// every RSVP request, and the service checks it against the stored
// attendee list. Declining "on someone else's behalf" becomes an
// explicit 403 rather than a silent forged reply.
const RsvpChoice = Schema.Literals(['accepted', 'declined', 'tentative'])

const AttendeeInput = Schema.Struct({
	email: Schema.String,
	name: Schema.optional(Schema.NullOr(Schema.String)),
})

// ── Availability ─────────────────────────────────────────────────

const FindAvailability = Tool.make('find_availability', {
	description:
		'List bookable slots for an event type between two ISO-8601 datetimes. Slots are cached per (eventTypeId, from, to) for 60 seconds, so calling this tool repeatedly for the same window is cheap. Returns [] if the event type is fully booked in the window (NoAvailability is flattened to empty array).',
	parameters: Schema.Struct({
		event_type_id: Schema.String,
		from: Schema.String,
		to: Schema.String,
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'Find Availability')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Bookings (write) ─────────────────────────────────────────────

const ScheduleMeeting = Tool.make('schedule_meeting', {
	description:
		'Book a meeting via the configured calendar provider (cal.com by default). Returns the persisted calendar_events row. Automatically computes end_at from the event type duration, writes the booking, adds attendees, and fires MeetingScheduled on the timeline so last_meeting_at/next_calendar_event_at denorm columns update in the same transaction.',
	parameters: Schema.Struct({
		event_type_id: Schema.String,
		start_at: Schema.String,
		attendees: Schema.Array(AttendeeInput),
		organizer_email: Schema.String,
		company_id: Schema.optional(Schema.NullOr(Schema.String)),
		contact_id: Schema.optional(Schema.NullOr(Schema.String)),
		metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Schedule Meeting')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const RescheduleMeeting = Tool.make('reschedule_meeting', {
	description:
		'Move an existing booking to a new start time. Only valid for source="booking" events with a provider booking id; email-sourced or internal events return InvalidRsvpTarget with reason="reschedule_only_for_booking_source". Preserves duration (end_at = new_start + original duration).',
	parameters: Schema.Struct({
		calendar_event_id: Schema.String,
		new_start_at: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Reschedule Meeting')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const CancelMeeting = Tool.make('cancel_meeting', {
	description:
		'Cancel a calendar event. Source decides the outbound path: booking -> provider cancel; email -> status flip only (we cannot cancel an invitation we did not own); internal -> row update with no network. Fires MeetingCancelled on the timeline so next_calendar_event_at is recomputed from the remaining confirmed rows.',
	parameters: Schema.Struct({
		calendar_event_id: Schema.String,
		reason: Schema.optional(Schema.NullOr(Schema.String)),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Cancel Meeting')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, true)

// ── Invitation lifecycle ─────────────────────────────────────────

const RespondToInvitation = Tool.make('respond_to_invitation', {
	description:
		'RSVP to a calendar invitation. attendee_email must be on the stored attendee list for the event (protects against agents forging replies for someone else — returns CannotRsvpForSomeoneElse with 403 otherwise). Source dispatches: booking -> provider accept/decline; email -> METHOD=REPLY ICS built and returned as replyIcs bytes for the caller to send via email.reply; internal -> InvalidRsvpTarget. rsvp=tentative on a provider that does not support it is absorbed locally (UnsupportedRsvp caught) so the local attendee row still records the intent.',
	parameters: Schema.Struct({
		calendar_event_id: Schema.String,
		attendee_email: Schema.String,
		rsvp: RsvpChoice,
		comment: Schema.optional(Schema.NullOr(Schema.String)),
		actor_user_id: Schema.optional(Schema.NullOr(Schema.String)),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Respond to Invitation')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const RsvpPendingInvitations = Tool.make('rsvp_pending_invitations', {
	description:
		'List every upcoming calendar event where the given attendee email still has rsvp="needs-action" and start_at > now(). Useful for the agent to proactively surface invitations the user has not replied to. Sorted by start_at ascending; excludes cancelled events.',
	parameters: Schema.Struct({
		attendee_email: Schema.String,
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Pending Invitations')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ForwardInvitation = Tool.make('forward_invitation', {
	description:
		'Rebuild a METHOD=REQUEST ICS for an existing calendar event with the same UID and sequence so downstream systems dedup it, adding the given recipient as an ATTENDEE. Refuses cancelled events (no point forwarding dead invites). Returns the bytes — the caller pairs this with email.send to deliver.',
	parameters: Schema.Struct({
		calendar_event_id: Schema.String,
		to_email: Schema.String,
		note: Schema.optional(Schema.NullOr(Schema.String)),
	}),
	success: Schema.Struct({
		ics_base64: Schema.String,
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Forward Invitation')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Read surface ─────────────────────────────────────────────────

const ListUpcoming = Tool.make('list_upcoming_meetings', {
	description:
		'List upcoming calendar events (status!=cancelled, start_at > now()) with filters. Returns the raw calendar_events rows so the agent can pick by source, title, or attendee. Default limit is 25.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
		contact_id: Schema.optional(Schema.String),
		source: Schema.optional(Schema.Literals(['booking', 'email', 'internal'])),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Upcoming Meetings')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ListEventTypes = Tool.make('list_event_types', {
	description:
		'List configured calendar event types (e.g., discovery / demo / onsite-visit). Agents use this to discover which durations exist before calling schedule_meeting. active=false rows are included by default — pass active=true to filter.',
	parameters: Schema.Struct({
		active: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Event Types')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Internal work blocks ────────────────────────────────────────

const CreateInternalBlock = Tool.make('create_internal_block', {
	description:
		'Create a local calendar block with no provider booking and no attendees (e.g., "prep for onsite Thursday"). Generates an ical_uid locally so future CalDAV export is a no-op. Use schedule_meeting instead if there should be external attendees.',
	parameters: Schema.Struct({
		title: Schema.String,
		start_at: Schema.String,
		end_at: Schema.String,
		organizer_email: Schema.String,
		company_id: Schema.optional(Schema.NullOr(Schema.String)),
		contact_id: Schema.optional(Schema.NullOr(Schema.String)),
		location_type: Schema.optional(
			Schema.Literals(['video', 'phone', 'address', 'link', 'none']),
		),
		location_value: Schema.optional(Schema.NullOr(Schema.String)),
		metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Create Internal Block')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Provider sync ───────────────────────────────────────────────

const SyncEventTypes = Tool.make('sync_event_types', {
	description:
		'Pull the latest event-type list from the calendar provider (title, duration_minutes, locations) and update local rows by (provider, provider_event_type_id). Safe to call on every boot + on demand; title/duration changes show up without a redeploy.',
	parameters: Schema.Struct({}),
	success: Schema.Struct({ synced: Schema.Number }),
})
	.annotate(Tool.Title, 'Sync Event Types')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

export const CalendarTools = Toolkit.make(
	FindAvailability,
	ScheduleMeeting,
	RescheduleMeeting,
	CancelMeeting,
	RespondToInvitation,
	RsvpPendingInvitations,
	ForwardInvitation,
	ListUpcoming,
	ListEventTypes,
	CreateInternalBlock,
	SyncEventTypes,
)

export const CalendarHandlersLive = CalendarTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* CalendarService
		const sql = yield* SqlClient.SqlClient
		// Pulled so the dispatcher closures below can re-inject it via
		// `provideService`; the toolkit contract requires each handler's
		// returned Effect to have R=never.
		const emailSvc = yield* EmailService
		return {
			find_availability: params =>
				svc
					.findAvailability({
						eventTypeId: params.event_type_id,
						from: new Date(params.from),
						to: new Date(params.to),
					})
					.pipe(Effect.orDie),
			schedule_meeting: params =>
				svc
					.scheduleMeeting({
						eventTypeId: params.event_type_id,
						startAt: new Date(params.start_at),
						attendees: params.attendees.map(a => ({
							email: a.email,
							name: a.name ?? null,
						})),
						organizerEmail: params.organizer_email,
						companyId: params.company_id ?? null,
						contactId: params.contact_id ?? null,
						metadata:
							params.metadata !== undefined && params.metadata !== null
								? (params.metadata as Record<string, unknown>)
								: null,
					})
					.pipe(Effect.orDie),
			reschedule_meeting: params =>
				svc
					.rescheduleMeeting({
						calendarEventId: params.calendar_event_id,
						newStartAt: new Date(params.new_start_at),
					})
					.pipe(Effect.orDie),
			cancel_meeting: params =>
				svc
					.cancelMeeting({
						calendarEventId: params.calendar_event_id,
						reason: params.reason ?? null,
					})
					.pipe(Effect.orDie),
			respond_to_invitation: params =>
				dispatchRsvpReply({
					calendarEventId: params.calendar_event_id,
					attendeeEmail: params.attendee_email,
					rsvp: params.rsvp,
					comment: params.comment ?? null,
					actorUserId: params.actor_user_id ?? null,
				}).pipe(
					Effect.map(r => ({
						_tag: 'replied' as const,
						updated: r.updated,
						rsvp: r.rsvp,
					})),
					Effect.catchTag('CannotRsvpForSomeoneElse', e =>
						Effect.succeed({
							_tag: 'forbidden' as const,
							reason: 'cannot_rsvp_for_someone_else',
							attendeeEmail: e.attendeeEmail,
						}),
					),
					Effect.catchTag('InvalidRsvpTarget', e =>
						Effect.succeed({
							_tag: 'invalid_target' as const,
							reason: e.reason,
						}),
					),
					Effect.catchTag('CalendarEventNotFound', e =>
						Effect.succeed({
							_tag: 'not_found' as const,
							calendarEventId: e.calendarEventId,
						}),
					),
					Effect.provideService(CalendarService, svc),
					Effect.provideService(EmailService, emailSvc),
					Effect.provideService(SqlClient.SqlClient, sql),
					Effect.orDie,
				),
			rsvp_pending_invitations: params =>
				svc
					.listPendingInvitations({
						attendeeEmail: params.attendee_email,
						limit: params.limit ?? 25,
					})
					.pipe(Effect.orDie),
			forward_invitation: params =>
				dispatchForwardInvitation({
					calendarEventId: params.calendar_event_id,
					toEmail: params.to_email,
					note: params.note ?? null,
				}).pipe(
					Effect.map(r => ({
						ics_base64: Buffer.from(r.ics).toString('base64'),
						messageId: 'messageId' in r ? r.messageId : null,
						threadId: 'threadId' in r ? r.threadId : null,
					})),
					Effect.catchTag('CalendarEventNotFound', e =>
						Effect.succeed({
							ics_base64: '',
							messageId: null,
							threadId: null,
							error: 'not_found' as const,
							calendarEventId: e.calendarEventId,
						}),
					),
					Effect.catchTag('InvalidRsvpTarget', e =>
						Effect.succeed({
							ics_base64: '',
							messageId: null,
							threadId: null,
							error: 'invalid_target' as const,
							reason: e.reason,
						}),
					),
					Effect.provideService(CalendarService, svc),
					Effect.provideService(EmailService, emailSvc),
					Effect.provideService(SqlClient.SqlClient, sql),
					Effect.orDie,
				),
			list_upcoming_meetings: params =>
				Effect.gen(function* () {
					const conditions: Array<Statement.Fragment> = [
						sql`start_at > now()`,
						sql`status <> 'cancelled'`,
					]
					if (params.company_id)
						conditions.push(sql`company_id = ${params.company_id}`)
					if (params.contact_id)
						conditions.push(sql`contact_id = ${params.contact_id}`)
					if (params.source) conditions.push(sql`source = ${params.source}`)
					const limit = params.limit ?? 25
					return yield* sql`
						SELECT * FROM calendar_events
						WHERE ${sql.and(conditions)}
						ORDER BY start_at ASC
						LIMIT ${limit}
					`
				}).pipe(Effect.orDie),
			list_event_types: params =>
				Effect.gen(function* () {
					const conditions: Array<Statement.Fragment> = []
					if (params.active === true) conditions.push(sql`active = true`)
					if (params.active === false) conditions.push(sql`active = false`)
					return yield* sql`
						SELECT * FROM calendar_event_types
						${conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``}
						ORDER BY slug
					`
				}).pipe(Effect.orDie),
			create_internal_block: params =>
				svc
					.createInternalBlock({
						title: params.title,
						startAt: new Date(params.start_at),
						endAt: new Date(params.end_at),
						organizerEmail: params.organizer_email,
						companyId: params.company_id ?? null,
						contactId: params.contact_id ?? null,
						locationType: params.location_type ?? 'none',
						locationValue: params.location_value ?? null,
						metadata:
							params.metadata !== undefined && params.metadata !== null
								? (params.metadata as Record<string, unknown>)
								: null,
					})
					.pipe(Effect.orDie),
			sync_event_types: () => svc.syncEventTypes().pipe(Effect.orDie),
		}
	}),
)
