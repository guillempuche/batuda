import { DateTime, Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, CurrentOrg, NotFound } from '@batuda/controllers'
import { Proposal } from '@batuda/domain'

import {
	ProposalEvent,
	TimelineActivityService,
} from '../services/timeline-activity'

const decodeProposal = Schema.decodeUnknownEffect(Proposal)
const decodeProposals = Schema.decodeUnknownEffect(Schema.Array(Proposal))

type ProposalEventKind = 'sent' | 'viewed' | 'responded'

const statusToEventKind = (status: string): ProposalEventKind | null => {
	if (status === 'sent' || status === 'viewed' || status === 'responded')
		return status
	return null
}

// Statuses that mean the customer got back to us — the point we stamp when they
// responded, so a reply time can be measured.
const RESPONDED_STATUSES = new Set([
	'responded',
	'negotiating',
	'accepted',
	'rejected',
])

export const ProposalsLive = HttpApiBuilder.group(
	BatudaApi,
	'proposals',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const timeline = yield* TimelineActivityService
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`company_id = ${_.query.companyId}`)
						const rows =
							yield* sql`SELECT * FROM proposals WHERE ${sql.and(conditions)}`
						return yield* decodeProposals(rows)
					}).pipe(Effect.orDie),
				)
				.handle('get', _ =>
					Effect.gen(function* () {
						const rows =
							yield* sql`SELECT * FROM proposals WHERE id = ${_.params.id} LIMIT 1`
						const proposal = rows[0]
						if (!proposal)
							return yield* new NotFound({
								entity: 'proposal',
								id: _.params.id,
							})
						return yield* decodeProposal(proposal)
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`INSERT INTO proposals ${sql.insert({
							..._.payload,
							organizationId: currentOrg.id,
						})} RETURNING *`
						yield* Effect.logInfo('Proposal created').pipe(
							Effect.annotateLogs({
								event: 'proposal.created',
								companyId: _.payload.companyId,
							}),
						)
						const created = rows[0]
						if (created === undefined)
							return yield* Effect.die(
								new Error('proposal insert returned no row'),
							)
						return yield* decodeProposal(created)
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const payload = _.payload as { status?: string }

						const existing = yield* sql<{
							status: string
							companyId: string
							contactId: string | null
						}>`
							SELECT status, company_id, contact_id FROM proposals
							WHERE id = ${_.params.id} LIMIT 1
						`
						const before = existing[0]

						// Stamp the moment the proposal was sent, and the moment the
						// customer first responded, on the transition into each — so a
						// send date and a reply time can be read off the row later.
						const now = DateTime.toDateUtc(DateTime.nowUnsafe())
						const newStatus = payload.status
						const stamps: Record<string, unknown> = {}
						if (newStatus === 'sent' && before?.status !== 'sent') {
							stamps['sentAt'] = now
						}
						if (
							newStatus !== undefined &&
							RESPONDED_STATUSES.has(newStatus) &&
							!RESPONDED_STATUSES.has(before?.status ?? '')
						) {
							stamps['respondedAt'] = now
						}

						const rows = yield* sql`
							UPDATE proposals SET ${sql.update({ ..._.payload, ...stamps, updatedAt: now })}
							WHERE id = ${_.params.id} RETURNING *
						`

						const eventKind = newStatus ? statusToEventKind(newStatus) : null
						if (before && eventKind && before.status !== newStatus) {
							yield* timeline.record(
								new ProposalEvent({
									proposalId: _.params.id,
									kind: eventKind,
									companyId: before.companyId,
									contactId: before.contactId,
									actorUserId: null,
									occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
								}),
							)
						}

						yield* Effect.logInfo('Proposal updated').pipe(
							Effect.annotateLogs({
								event: 'proposal.updated',
								proposalId: _.params.id,
							}),
						)
						const row = rows[0]
						return row === undefined ? null : yield* decodeProposal(row)
					}).pipe(Effect.orDie),
				)
		}),
)
