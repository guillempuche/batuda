import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const TimelineActivityId = Schema.String.pipe(
	Schema.brand('TimelineActivityId'),
)

export const TimelineKind = Schema.Literals([
	'email_sent',
	'email_received',
	// A message we sent came back undelivered.
	'email_bounced',
	'call_logged',
	// A touchpoint logged by hand on any channel other than the phone — a
	// visit, a WhatsApp message, a chat at an event. Which one it was lives
	// in `channel`, so a new channel never needs a new kind here.
	'interaction_logged',
	'document_created',
	'proposal_sent',
	'proposal_viewed',
	'proposal_responded',
	'research_run',
	'research_applied',
	'system_event',
	'stage_changed',
	// A company taken out of view, and put back. Its people, work and history
	// go with it, so the account's own log is where that has to be visible.
	'company_deleted',
	'company_restored',
	'meeting_scheduled',
	'meeting_rescheduled',
	'meeting_cancelled',
	'meeting_rsvp',
	'task_created',
	'task_updated',
	'task_completed',
])
export type TimelineKind = typeof TimelineKind.Type

export const TimelineEntityType = Schema.Literals([
	'email_message',
	'interaction',
	'call_recording',
	'document',
	'proposal',
	'research_run',
	'system',
	'calendar_event',
	'task',
])
export type TimelineEntityType = typeof TimelineEntityType.Type

export const TimelineDirection = Schema.Literals(['inbound', 'outbound'])
export type TimelineDirection = typeof TimelineDirection.Type

export class TimelineActivity extends Model.Class<TimelineActivity>(
	'TimelineActivity',
)({
	id: Model.GeneratedByDb(TimelineActivityId),
	kind: TimelineKind,
	entityType: TimelineEntityType,
	entityId: Schema.String,
	companyId: Schema.NullOr(Schema.String),
	contactId: Schema.NullOr(Schema.String),
	channel: Schema.NullOr(Schema.String),
	direction: Schema.NullOr(TimelineDirection),
	actorUserId: Schema.NullOr(Schema.String),
	occurredAt: Schema.DateTimeUtcFromDate,
	summary: Schema.NullOr(Schema.String),
	payload: Schema.Unknown,
	createdAt: Model.DateTimeInsertFromDate,
}) {}
