import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ContactId = Schema.String.pipe(Schema.brand('ContactId'))

export const EmailStatus = Schema.Literals([
	'unknown',
	'valid',
	'bounced',
	'complained',
])
export type EmailStatus = typeof EmailStatus.Type

export class Contact extends Model.Class<Contact>('Contact')({
	id: Model.Generated(ContactId),
	companyId: Schema.String,

	name: Schema.String,
	role: Schema.NullOr(Schema.String),
	isDecisionMaker: Schema.NullOr(Schema.Boolean),

	email: Schema.NullOr(Schema.String),
	phone: Schema.NullOr(Schema.String),
	whatsapp: Schema.NullOr(Schema.String),
	linkedin: Schema.NullOr(Schema.String),
	instagram: Schema.NullOr(Schema.String),

	emailStatus: EmailStatus,
	emailStatusReason: Schema.NullOr(Schema.String),
	emailStatusUpdatedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	emailSoftBounceCount: Schema.Number,

	notes: Schema.NullOr(Schema.String),
	metadata: Schema.NullOr(Schema.Unknown),

	lastEmailAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastCallAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastMeetingAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	nextCalendarEventAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
