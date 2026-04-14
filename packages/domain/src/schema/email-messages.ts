import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const EmailMessageId = Schema.String.pipe(Schema.brand('EmailMessageId'))

export const EmailDirection = Schema.Literals(['outbound', 'inbound'])
export type EmailDirection = typeof EmailDirection.Type

export const EmailMessageStatus = Schema.Literals([
	'sent',
	'delivered',
	'bounced',
	'bounced_soft',
	'complained',
	'rejected',
])
export type EmailMessageStatus = typeof EmailMessageStatus.Type

export const InboundClassification = Schema.Literals([
	'normal',
	'spam',
	'blocked',
])
export type InboundClassification = typeof InboundClassification.Type

export class EmailMessage extends Model.Class<EmailMessage>('EmailMessage')({
	id: Model.Generated(EmailMessageId),
	provider: Schema.String,
	providerMessageId: Schema.String,
	providerThreadId: Schema.String,
	providerInboxId: Schema.String,
	direction: EmailDirection,
	companyId: Schema.NullOr(Schema.String),
	contactId: Schema.NullOr(Schema.String),
	recipients: Schema.Array(Schema.String),
	status: EmailMessageStatus,
	statusReason: Schema.NullOr(Schema.String),
	bounceType: Schema.NullOr(Schema.String),
	bounceSubType: Schema.NullOr(Schema.String),
	inboundClassification: Schema.NullOr(InboundClassification),
	statusUpdatedAt: Schema.DateTimeUtcFromDate,
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeInsertFromDate,
}) {}
