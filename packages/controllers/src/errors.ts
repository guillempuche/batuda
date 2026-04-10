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

export class Conflict extends Schema.TaggedErrorClass<Conflict>()('Conflict', {
	message: Schema.String,
}) {}

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

// Storage operation that failed — narrows the error site so callers can
// decide whether to retry, surface to the user, or roll back a DB tx.
// `head` covers existence/metadata probes; `presign` covers signed URL
// generation (no network round-trip but can fail on bad config).
export const StorageErrorOperation = Schema.Literals([
	'put',
	'get',
	'delete',
	'head',
	'presign',
])
export type StorageErrorOperation = typeof StorageErrorOperation.Type

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
	'StorageError',
	{
		message: Schema.String,
		operation: StorageErrorOperation,
		// The S3 object key the operation targeted, when applicable.
		key: Schema.NullOr(Schema.String),
	},
) {}
