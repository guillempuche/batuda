import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ContactId = Schema.String.pipe(Schema.brand('ContactId'))

// Reachable addresses (email, phone, linkedin, …) live in `contact_channels`,
// the single source of truth — `contacts` carries only identity + activity.
export class Contact extends Model.Class<Contact>('Contact')({
	id: Model.Generated(ContactId),
	companyId: Schema.String,

	name: Schema.String,
	role: Schema.NullOr(Schema.String),
	isDecisionMaker: Schema.NullOr(Schema.Boolean),

	notes: Schema.NullOr(Schema.String),
	metadata: Schema.NullOr(Schema.Unknown),

	lastEmailAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastCallAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastMeetingAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	nextCalendarEventAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
