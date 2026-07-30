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

// One reachable channel for a contact, as it crosses the wire.
//
// This is the shape the HTTP API and the web app agree on, which is deliberately
// not the shape the database holds: storage keys a channel by its subject (a
// company or a person) and calls the two main columns `channel` and `address`.
// The service names every key explicitly on the way out, so the columns can be
// renamed — or a company's channels can start being stored beside a person's —
// without a caller noticing. Moving this shape is then a separate, deliberate
// decision rather than a side effect.
//
// `kind` is open free text — `email`, `phone`, `linkedin`, `x`, `website`,
// `bluesky`, `mastodon`, … — so a new platform needs no migration. The email
// channel additionally carries a deliverability `verification` (discovery
// verdict) and a send-suppression `status` with its bounce bookkeeping.
export class ContactChannel extends Model.Class<ContactChannel>(
	'ContactChannel',
)({
	id: Model.GeneratedByDb(ContactChannelId),
	contactId: Schema.String,
	kind: Schema.String,
	value: Schema.String,
	// Which of several this one is, in a person's own words — "Girona shop",
	// "sales office". Null when there is only one and no distinction to draw.
	label: Schema.NullOr(Schema.String),
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
