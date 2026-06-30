import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import {
	ProposalEvent,
	TimelineActivityService,
} from '../../services/timeline-activity'
import { ListResult, toItems } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg]

// Only sent/viewed/responded project onto the timeline; draft, expired,
// declined and accepted update the proposal row silently.
const statusToEventKind = (status: string): ProposalEvent['kind'] | null => {
	if (status === 'sent' || status === 'viewed' || status === 'responded')
		return status
	return null
}

const ListProposals = Tool.make('list_proposals', {
	description:
		'List proposals in the organization, optionally filtered by company_id. Returns id, company_id, contact_id, status, title, line_items, total_value, currency, sent_at, expires_at, responded_at, notes, metadata, created_at.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
	}),
	success: ListResult(Schema.Unknown),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Proposals')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateProposal = Tool.make('create_proposal', {
	description:
		'Create a proposal for a company. line_items is free-form JSON (rows with quantity/unit_price/description); status defaults to "draft" until later promoted via update_proposal.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		contact_id: Schema.optional(Schema.String),
		title: Schema.String,
		line_items: Schema.Unknown,
		total_value: Schema.optional(Schema.String),
		currency: Schema.optional(Schema.String),
		expires_at: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.String),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Create Proposal')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateProposal = Tool.make('update_proposal', {
	description:
		'Update fields on an existing proposal by id. Transitioning status to sent|viewed|responded records a ProposalEvent on the timeline. Other status values update the row silently.',
	parameters: Schema.Struct({
		id: Schema.String,
		status: Schema.optional(Schema.String),
		title: Schema.optional(Schema.String),
		line_items: Schema.optional(Schema.Unknown),
		total_value: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.String),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Update Proposal')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const ProposalTools = Toolkit.make(
	ListProposals,
	CreateProposal,
	UpdateProposal,
)

export const ProposalHandlersLive = ProposalTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService
		return {
			list_proposals: ({ company_id }) =>
				Effect.gen(function* () {
					if (company_id) {
						return yield* sql`SELECT * FROM proposals WHERE company_id = ${company_id} ORDER BY created_at DESC`
					}
					return yield* sql`SELECT * FROM proposals ORDER BY created_at DESC`
				}).pipe(Effect.orDie, Effect.map(toItems)),
			create_proposal: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const row: Record<string, unknown> = {
						organizationId: currentOrg.id,
						companyId: params.company_id,
						title: params.title,
						lineItems: params.line_items,
					}
					if (params.contact_id !== undefined)
						row['contactId'] = params.contact_id
					if (params.total_value !== undefined)
						row['totalValue'] = params.total_value
					if (params.currency !== undefined) row['currency'] = params.currency
					if (params.expires_at !== undefined)
						row['expiresAt'] = params.expires_at
					if (params.notes !== undefined) row['notes'] = params.notes
					if (params.metadata !== undefined) row['metadata'] = params.metadata
					const rows =
						yield* sql`INSERT INTO proposals ${sql.insert(row)} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
			update_proposal: ({ id, ...rest }) =>
				Effect.gen(function* () {
					const existing = yield* sql<{
						status: string
						companyId: string
						contactId: string | null
					}>`
						SELECT status, company_id, contact_id FROM proposals
						WHERE id = ${id} LIMIT 1
					`
					const before = existing[0]

					const data: Record<string, unknown> = {
						updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					}
					if (rest.status !== undefined) data['status'] = rest.status
					if (rest.title !== undefined) data['title'] = rest.title
					if (rest.line_items !== undefined) data['lineItems'] = rest.line_items
					if (rest.total_value !== undefined)
						data['totalValue'] = rest.total_value
					if (rest.notes !== undefined) data['notes'] = rest.notes
					if (rest.metadata !== undefined) data['metadata'] = rest.metadata
					const rows = yield* sql`
						UPDATE proposals SET ${sql.update(data, ['id'])}
						WHERE id = ${id} RETURNING *
					`

					const eventKind = rest.status ? statusToEventKind(rest.status) : null
					if (before && eventKind && before.status !== rest.status) {
						yield* timeline.record(
							new ProposalEvent({
								proposalId: id,
								kind: eventKind,
								companyId: before.companyId,
								contactId: before.contactId,
								actorUserId: null,
								occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							}),
						)
					}

					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
