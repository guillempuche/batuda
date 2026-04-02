import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { ForjaApi } from '../api'

export const InteractionsLive = HttpApiBuilder.group(
	ForjaApi,
	'interactions',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`company_id = ${_.query.companyId}`)
						return yield* sql`
							SELECT * FROM interactions
							WHERE ${sql.and(conditions)}
							ORDER BY date DESC
							LIMIT ${_.query.limit ?? 20}
						`
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const payload = _.payload as any
						const data = {
							...payload,
							date: payload.date ?? new Date(),
						}
						const rows =
							yield* sql`INSERT INTO interactions ${sql.insert(data)} RETURNING *`

						// Auto-update company
						const companyUpdate: Record<string, unknown> = {
							lastContactedAt: new Date(),
							updatedAt: new Date(),
						}
						if (payload.nextAction)
							companyUpdate['nextAction'] = payload.nextAction
						if (payload.nextActionAt)
							companyUpdate['nextActionAt'] = payload.nextActionAt

						yield* sql`UPDATE companies SET ${sql.update(companyUpdate, ['id'])} WHERE id = ${payload.companyId}`

						yield* Effect.logInfo('Interaction logged').pipe(
							Effect.annotateLogs({
								event: 'interaction.logged',
								companyId: payload.companyId,
								channel: payload.channel,
								direction: payload.direction,
							}),
						)

						return rows[0]
					}).pipe(Effect.orDie),
				)
		}),
)
