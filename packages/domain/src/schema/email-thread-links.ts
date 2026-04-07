import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const EmailThreadLinkId = Schema.String.pipe(
	Schema.brand('EmailThreadLinkId'),
)

export class EmailThreadLink extends Model.Class<EmailThreadLink>(
	'EmailThreadLink',
)({
	id: Model.Generated(EmailThreadLinkId),
	agentmailThreadId: Schema.String,
	agentmailInboxId: Schema.String,
	companyId: Schema.NullOr(Schema.String),
	contactId: Schema.NullOr(Schema.String),
	subject: Schema.NullOr(Schema.String),
	status: Schema.String,
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeInsertFromDate,
}) {}
