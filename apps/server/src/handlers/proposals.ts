import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { ForjaApi } from '../api'

export const ProposalsLive = HttpApiBuilder.group(
	ForjaApi,
	'proposals',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
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
						const rows = yield* sql`
							UPDATE proposals SET ${sql.update({ ...(_.payload as any), updatedAt: new Date() }, ['id'])}
							WHERE id = ${_.params.id} RETURNING *
						`
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
