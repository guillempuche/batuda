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

export class Forbidden extends Schema.TaggedErrorClass<Forbidden>()(
	'Forbidden',
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

// ── Inbox lifecycle errors (route-level, status-mapped) ──

/** No default inbox configured for the calling member. Returned as 409. */
export class NoDefaultInbox extends Schema.TaggedErrorClass<NoDefaultInbox>()(
	'NoDefaultInbox',
	{ message: Schema.String },
) {}

/** Inbox row exists but is `active=false`. Returned as 409. */
export class InboxInactive extends Schema.TaggedErrorClass<InboxInactive>()(
	'InboxInactive',
	{ inboxId: Schema.String },
) {}

/** IMAP/SMTP probe rejected the credentials. Returned as 409. */
export class GrantAuthFailed extends Schema.TaggedErrorClass<GrantAuthFailed>()(
	'GrantAuthFailed',
	{ inboxId: Schema.String, detail: Schema.NullOr(Schema.String) },
) {}

/** IMAP/SMTP probe could not reach the server. Returned as 409. */
export class GrantConnectFailed extends Schema.TaggedErrorClass<GrantConnectFailed>()(
	'GrantConnectFailed',
	{ inboxId: Schema.String, detail: Schema.NullOr(Schema.String) },
) {}

/** Inbox grant is in a non-`connected` state. Returned as 409. */
export class GrantUnavailable extends Schema.TaggedErrorClass<GrantUnavailable>()(
	'GrantUnavailable',
	{
		inboxId: Schema.String,
		grantStatus: Schema.Literals(['auth_failed', 'connect_failed', 'disabled']),
	},
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

// ── Research HTTP errors (route-level, status-mapped) ──
// Domain-level research errors (ProviderError, BudgetExceeded, etc.) live
// in @batuda/research. These are the HTTP-facing subset used in route
// definitions for 409 responses.

/** Pre-run estimate exceeds available budget. Returned as 409. */
export class InsufficientBudget extends Schema.TaggedErrorClass<InsufficientBudget>()(
	'InsufficientBudget',
	{
		estimatedCents: Schema.Number,
		availableCents: Schema.Number,
		shortfallCents: Schema.Number,
	},
) {}

/** Fan-out exceeds confirm threshold. Returned as 409 with preview. */
export class ConfirmRequired extends Schema.TaggedErrorClass<ConfirmRequired>()(
	'ConfirmRequired',
	{
		estimatedCostCents: Schema.Number,
		subjectCount: Schema.Number,
	},
) {}
