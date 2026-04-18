import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { ForjaApi } from '@engranatge/controllers'

export const TimelineLive = HttpApiBuilder.group(
	ForjaApi,
	'timeline',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return handlers.handle('list', _ =>
				Effect.gen(function* () {
					const conditions: Array<Statement.Fragment> = []
					if (_.query.companyId)
						conditions.push(sql`company_id = ${_.query.companyId}`)
					if (_.query.contactId)
						conditions.push(sql`contact_id = ${_.query.contactId}`)
					if (_.query.channel)
						conditions.push(sql`channel = ${_.query.channel}`)
					if (_.query.kind) conditions.push(sql`kind = ${_.query.kind}`)
					if (_.query.since) {
						const since = new Date(_.query.since)
						if (!Number.isNaN(since.getTime())) {
							conditions.push(sql`occurred_at >= ${since}`)
						}
					}
					const limit = Math.min(_.query.limit ?? 50, 200)
					const whereClause =
						conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
					return yield* sql`
						SELECT * FROM timeline_activity
						${whereClause}
						ORDER BY occurred_at DESC
						LIMIT ${limit}
					`
				}).pipe(Effect.orDie),
			)
		}),
)
