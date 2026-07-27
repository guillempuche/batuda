import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Proposal } from '@batuda/domain'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'

const CreateProposalInput = Schema.Struct({
	companyId: Schema.String,
	contactId: Schema.optional(Schema.String),
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	lineItems: Schema.Unknown,
	totalValue: Schema.optional(Schema.String),
	currency: Schema.optional(Schema.String),
	// An ISO date string (e.g. "2026-08-01"), passed straight to the timestamptz
	// column — a decoded DateTime object doesn't serialize into the SQL insert.
	expiresAt: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

const UpdateProposalInput = Schema.Struct({
	status: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	lineItems: Schema.optional(Schema.Unknown),
	totalValue: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

export const ProposalsGroup = HttpApiGroup.make('proposals')
	.add(
		HttpApiEndpoint.get('list', '/proposals', {
			query: {
				companyId: Schema.optional(Schema.String),
				...pageQuery,
			},
			success: PaginatedList(Proposal.json),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/proposals/:id', {
			params: { id: Schema.String },
			success: Proposal.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/proposals', {
			payload: CreateProposalInput,
			success: Proposal.json,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/proposals/:id', {
			params: { id: Schema.String },
			payload: UpdateProposalInput,
			success: Schema.NullOr(Proposal.json),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
