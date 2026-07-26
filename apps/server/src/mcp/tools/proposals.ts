import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'
import { Proposal } from '@batuda/domain'

import {
	ProposalEvent,
	TimelineActivityService,
} from '../../services/timeline-activity'
import { ListResult, toItems } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg]

const decodeProposal = Schema.decodeUnknownEffect(Proposal)
const decodeProposals = Schema.decodeUnknownEffect(Schema.Array(Proposal))

// Only sent/viewed/responded project onto the timeline; draft, expired,
// declined and accepted update the proposal row silently.
const statusToEventKind = (status: string): ProposalEvent['kind'] | null => {
	if (status === 'sent' || status === 'viewed' || status === 'responded')
		return status
	return null
}

// Statuses that mean the customer got back to us — stamped when they responded.
const RESPONDED_STATUSES = new Set([
	'responded',
	'negotiating',
	'accepted',
	'rejected',
])

const ListProposals = Tool.make('list_proposals', {
	description:
		'List proposals in the organization, optionally filtered by company_id. Returns id, company_id, contact_id, status, title, line_items, total_value, currency, sent_at, expires_at, responded_at, notes, metadata, created_at.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
	}),
	success: ListResult(Proposal.json),
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
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Proposal.json,
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
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.NullOr(Proposal.json),
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
					const rows = company_id
						? yield* sql`SELECT * FROM proposals WHERE company_id = ${company_id} ORDER BY created_at DESC`
						: yield* sql`SELECT * FROM proposals ORDER BY created_at DESC`
					return toItems(yield* decodeProposals(rows))
				}).pipe(Effect.orDie),
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
					if (params.metadata !== undefined) row['metadata'] = params.metadata
					const rows =
						yield* sql`INSERT INTO proposals ${sql.insert(row)} RETURNING *`
					const created = rows[0]
					if (created === undefined)
						return yield* Effect.die(
							new Error('proposal insert returned no row'),
						)
					return yield* decodeProposal(created)
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
					if (rest.metadata !== undefined) data['metadata'] = rest.metadata
					// Stamp the send/first-response moments on the transition into each.
					if (rest.status === 'sent' && before?.status !== 'sent') {
						data['sentAt'] = DateTime.toDateUtc(DateTime.nowUnsafe())
					}
					if (
						rest.status !== undefined &&
						RESPONDED_STATUSES.has(rest.status) &&
						!RESPONDED_STATUSES.has(before?.status ?? '')
					) {
						data['respondedAt'] = DateTime.toDateUtc(DateTime.nowUnsafe())
					}
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

					const row = rows[0]
					return row === undefined ? null : yield* decodeProposal(row)
				}).pipe(Effect.orDie),
		}
	}),
)
