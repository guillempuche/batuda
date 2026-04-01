import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

const CreateProposalInput = Schema.Struct({
	companyId: Schema.String,
	contactId: Schema.optional(Schema.String),
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	lineItems: Schema.Unknown,
	totalValue: Schema.optional(Schema.String),
	currency: Schema.optional(Schema.String),
	expiresAt: Schema.optional(Schema.DateTimeUtc),
	notes: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

const UpdateProposalInput = Schema.Struct({
	status: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	lineItems: Schema.optional(Schema.Unknown),
	totalValue: Schema.optional(Schema.String),
	notes: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

export const ProposalsGroup = HttpApiGroup.make('proposals')
	.add(
		HttpApiEndpoint.get('list', '/proposals', {
			query: {
				companyId: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/proposals', {
			payload: CreateProposalInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/proposals/:id', {
			params: { id: Schema.String },
			payload: UpdateProposalInput,
			success: Schema.Unknown,
		}),
	)
	.prefix('/api')
