import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ContactChannelId = Schema.String.pipe(
	Schema.brand('ContactChannelId'),
)

// One reachable channel for a contact. `kind` is open free text — `email`,
// `phone`, `linkedin`, `x`, `website`, `bluesky`, `mastodon`, … — so a new
// platform needs no migration. Only the email channel carries a deliverability
// `verification`; `contacts.email` stays the canonical send address.
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
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
