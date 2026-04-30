import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

const CreateContactInput = Schema.Struct({
	companyId: Schema.String,
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	role: Schema.optional(Schema.String),
	isDecisionMaker: Schema.optional(Schema.Boolean),
	email: Schema.optional(Schema.String),
	phone: Schema.optional(Schema.String),
	whatsapp: Schema.optional(Schema.String),
	linkedin: Schema.optional(Schema.String),
	instagram: Schema.optional(Schema.String),
	notes: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

const UpdateContactInput = Schema.Struct({
	name: Schema.optional(Schema.String),
	role: Schema.optional(Schema.String),
	isDecisionMaker: Schema.optional(Schema.Boolean),
	email: Schema.optional(Schema.String),
	phone: Schema.optional(Schema.String),
	whatsapp: Schema.optional(Schema.String),
	linkedin: Schema.optional(Schema.String),
	instagram: Schema.optional(Schema.String),
	notes: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

export const ContactsGroup = HttpApiGroup.make('contacts')
	.add(
		HttpApiEndpoint.get('list', '/contacts', {
			query: {
				companyId: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/contacts', {
			payload: CreateContactInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/contacts/:id', {
			params: { id: Schema.String },
			payload: UpdateContactInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.delete('remove', '/contacts/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
