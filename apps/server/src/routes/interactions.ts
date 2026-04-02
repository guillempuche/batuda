import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

const CreateInteractionInput = Schema.Struct({
	companyId: Schema.String,
	contactId: Schema.optional(Schema.String),
	date: Schema.optional(Schema.DateTimeUtc),
	durationMin: Schema.optional(Schema.Number),
	channel: Schema.String,
	direction: Schema.String,
	type: Schema.String,
	subject: Schema.optional(Schema.String),
	summary: Schema.optional(Schema.String),
	outcome: Schema.optional(Schema.String),
	nextAction: Schema.optional(Schema.String),
	nextActionAt: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

export const InteractionsGroup = HttpApiGroup.make('interactions')
	.add(
		HttpApiEndpoint.get('list', '/interactions', {
			query: {
				companyId: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/interactions', {
			payload: CreateInteractionInput,
			success: Schema.Unknown,
		}),
	)
	.prefix('/v1')
