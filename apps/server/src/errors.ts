import { Schema } from 'effect'

export class NotFound extends Schema.TaggedErrorClass<NotFound>()('NotFound', {
	entity: Schema.String,
	id: Schema.String,
}) {}

export class BadRequest extends Schema.TaggedErrorClass<BadRequest>()(
	'BadRequest',
	{ message: Schema.String },
) {}

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
	'Unauthorized',
	{ message: Schema.String },
) {}

export const EmailSendErrorKind = Schema.Literals([
	'suppressed',
	'invalid_recipient',
	'rate_limited',
	'unknown',
])
export type EmailSendErrorKind = typeof EmailSendErrorKind.Type

export class EmailSendError extends Schema.TaggedErrorClass<EmailSendError>()(
	'EmailSendError',
	{
		message: Schema.String,
		kind: EmailSendErrorKind,
		recipient: Schema.NullOr(Schema.String),
	},
) {}

export class EmailSuppressed extends Schema.TaggedErrorClass<EmailSuppressed>()(
	'EmailSuppressed',
	{
		contactId: Schema.NullOr(Schema.String),
		recipient: Schema.String,
		status: Schema.Literals(['bounced', 'complained']),
		reason: Schema.NullOr(Schema.String),
	},
) {}

export class EmailError extends Schema.TaggedErrorClass<EmailError>()(
	'EmailError',
	{ message: Schema.String },
) {}
