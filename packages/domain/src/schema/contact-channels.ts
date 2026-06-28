import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ContactChannelId = Schema.String.pipe(
	Schema.brand('ContactChannelId'),
)

// Email-send suppression state, carried by the primary email channel: the send
// gate blocks 'bounced'/'complained', and the mail worker's DSN handler sets it
// when a delivery fails.
export const EmailStatus = Schema.Literals([
	'unknown',
	'valid',
	'bounced',
	'complained',
])
export type EmailStatus = typeof EmailStatus.Type

// One reachable channel for a contact. `kind` is open free text — `email`,
// `phone`, `linkedin`, `x`, `website`, `bluesky`, `mastodon`, … — so a new
// platform needs no migration. The email channel additionally carries a
// deliverability `verification` (discovery verdict) and a send-suppression
// `status` with its bounce bookkeeping.
export class ContactChannel extends Model.Class<ContactChannel>(
	'ContactChannel',
)({
	id: Model.Generated(ContactChannelId),
	contactId: Schema.String,
	kind: Schema.String,
	value: Schema.String,
	verification: Schema.NullOr(Schema.String),
	confidence: Schema.NullOr(Schema.Number),
	isPrimary: Schema.Boolean,

	status: EmailStatus,
	statusReason: Schema.NullOr(Schema.String),
	statusUpdatedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	softBounceCount: Schema.Number,

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
