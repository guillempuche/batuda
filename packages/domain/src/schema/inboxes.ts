import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const InboxId = Schema.String.pipe(Schema.brand('InboxId'))

export const InboxTransportSecurity = Schema.Literals([
	'tls',
	'starttls',
	'plain',
])
export type InboxTransportSecurity = typeof InboxTransportSecurity.Type

export const InboxGrantStatus = Schema.Literals([
	'connected',
	'auth_failed',
	'connect_failed',
	'disabled',
])
export type InboxGrantStatus = typeof InboxGrantStatus.Type

// A connected IMAP+SMTP mailbox. The AES-256-GCM credential columns
// (password ciphertext/nonce/tag) and the folder-sync checkpoint state
// are DELIBERATELY absent: this schema only ever carries the fields safe
// to hand back across the API boundary, so a decode of a raw row strips
// the secrets even if a query selects them.
export class Inbox extends Model.Class<Inbox>('Inbox')({
	id: Model.GeneratedByDb(InboxId),
	organizationId: Schema.String,
	email: Schema.String,
	displayName: Schema.NullOr(Schema.String),
	// What the mailbox is for, in whatever words fit. Free text: nothing
	// branches on it.
	description: Schema.NullOr(Schema.String),
	// Who may touch the mailbox follows from this: set means it belongs to that
	// person, null means it is the whole team's and so cannot be private.
	ownerUserId: Schema.NullOr(Schema.String),
	isDefault: Schema.Boolean,
	isPrivate: Schema.Boolean,
	active: Schema.Boolean,
	imapHost: Schema.String,
	imapPort: Schema.Number,
	imapSecurity: InboxTransportSecurity,
	smtpHost: Schema.String,
	smtpPort: Schema.Number,
	smtpSecurity: InboxTransportSecurity,
	// Login name only — never the password or its ciphertext.
	username: Schema.String,
	grantStatus: InboxGrantStatus,
	grantLastError: Schema.NullOr(Schema.String),
	grantLastSeenAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
