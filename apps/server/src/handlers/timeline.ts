import { Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '@batuda/controllers'
import { TimelineActivity } from '@batuda/domain'

import { resolvePageTotal } from '../lib/sql-pagination'

const decodeActivities = Schema.decodeUnknownEffect(
	Schema.Array(TimelineActivity),
)

export const TimelineLive = HttpApiBuilder.group(
	BatudaApi,
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
					const offset = _.query.offset ?? 0
					const whereClause =
						conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
					const rows = yield* sql<{ readonly total: string | number }>`
						SELECT *, COUNT(*) OVER () AS total FROM timeline_activity
						${whereClause}
						ORDER BY occurred_at DESC
						LIMIT ${limit} OFFSET ${offset}
					`
					const total = yield* resolvePageTotal(
						rows,
						offset,
						() => sql<{ readonly count: string | number }>`
							SELECT count(*) AS count FROM timeline_activity
							${whereClause}
						`,
					)
					const items = yield* decodeActivities(rows)
					return { items, total, limit, offset }
				}).pipe(Effect.orDie),
			)
		}),
)
