import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const TimelineActivityId = Schema.String.pipe(
	Schema.brand('TimelineActivityId'),
)

export const TimelineKind = Schema.Literals([
	'email_sent',
	'email_received',
	'call_logged',
	'document_created',
	'proposal_sent',
	'proposal_viewed',
	'proposal_responded',
	'research_run',
	'system_event',
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
])
export type TimelineEntityType = typeof TimelineEntityType.Type

export const TimelineDirection = Schema.Literals(['inbound', 'outbound'])
export type TimelineDirection = typeof TimelineDirection.Type

export class TimelineActivity extends Model.Class<TimelineActivity>(
	'TimelineActivity',
)({
	id: Model.Generated(TimelineActivityId),
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
