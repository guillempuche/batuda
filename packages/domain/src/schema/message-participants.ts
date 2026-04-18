import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const MessageParticipantId = Schema.String.pipe(
	Schema.brand('MessageParticipantId'),
)

export const ParticipantRole = Schema.Literals(['from', 'to', 'cc', 'bcc'])
export type ParticipantRole = typeof ParticipantRole.Type

export class MessageParticipant extends Model.Class<MessageParticipant>(
	'MessageParticipant',
)({
	id: Model.Generated(MessageParticipantId),
	emailMessageId: Schema.String,
	emailAddress: Schema.String,
	displayName: Schema.NullOr(Schema.String),
	role: ParticipantRole,
	contactId: Schema.NullOr(Schema.String),
	createdAt: Model.DateTimeInsertFromDate,
}) {}
