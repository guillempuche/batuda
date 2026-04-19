import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '@batuda/controllers'

import {
	ProposalEvent,
	TimelineActivityService,
} from '../services/timeline-activity'

type ProposalEventKind = 'sent' | 'viewed' | 'responded'

const statusToEventKind = (status: string): ProposalEventKind | null => {
	if (status === 'sent' || status === 'viewed' || status === 'responded')
		return status
	return null
}

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
						return yield* sql`SELECT * FROM proposals WHERE ${sql.and(conditions)}`
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const rows =
							yield* sql`INSERT INTO proposals ${sql.insert(_.payload as any)} RETURNING *`
						yield* Effect.logInfo('Proposal created').pipe(
							Effect.annotateLogs({
								event: 'proposal.created',
								companyId: (_.payload as any).companyId,
							}),
						)
						return rows[0]
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

						const rows = yield* sql`
							UPDATE proposals SET ${sql.update({ ...(_.payload as any), updatedAt: new Date() }, ['id'])}
							WHERE id = ${_.params.id} RETURNING *
						`

						const newStatus = payload.status
						const eventKind = newStatus ? statusToEventKind(newStatus) : null
						if (before && eventKind && before.status !== newStatus) {
							yield* timeline.record(
								new ProposalEvent({
									proposalId: _.params.id,
									kind: eventKind,
									companyId: before.companyId,
									contactId: before.contactId,
									actorUserId: null,
									occurredAt: new Date(),
								}),
							)
						}

						yield* Effect.logInfo('Proposal updated').pipe(
							Effect.annotateLogs({
								event: 'proposal.updated',
								proposalId: _.params.id,
							}),
						)
						return rows[0]
					}).pipe(Effect.orDie),
				)
		}),
)
