import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ContactId = Schema.String.pipe(Schema.brand('ContactId'))

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

	notes: Schema.NullOr(Schema.String),
	metadata: Schema.NullOr(Schema.Unknown),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
