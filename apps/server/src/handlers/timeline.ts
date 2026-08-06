import { Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '@batuda/controllers'
import { TimelineActivity } from '@batuda/domain'

import {
	pageOf,
	probeLimit,
	resolveTotal,
	takePage,
	totalColumn,
} from '../lib/sql-pagination'
import { companyVisible } from '../services/company-liveness'

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
					const conditions: Array<Statement.Fragment> = [
						// History belonging to a company nobody can open goes with it.
						companyVisible(sql, sql`company_id`),
					]
					if (_.query.companyId)
						conditions.push(sql`company_id = ${_.query.companyId}`)
					if (_.query.contactId)
						conditions.push(sql`contact_id = ${_.query.contactId}`)
					// Both together, or neither: an entity id means nothing without
					// the kind of record it belongs to, and ids are only unique
					// within their own table.
					if (_.query.entityType && _.query.entityId) {
						conditions.push(
							sql`entity_type = ${_.query.entityType} AND entity_id = ${_.query.entityId}`,
						)
					}
					if (_.query.channel)
						conditions.push(sql`channel = ${_.query.channel}`)
					if (_.query.kind) conditions.push(sql`kind = ${_.query.kind}`)
					if (_.query.since) {
						const since = new Date(_.query.since)
						if (!Number.isNaN(since.getTime())) {
							conditions.push(sql`occurred_at >= ${since}`)
						}
					}
					const page = pageOf(_.query, 50)
					const whereClause =
						conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
					const probed = yield* sql<{ readonly total?: string | number }>`
						SELECT *${totalColumn(sql, page.count)} FROM timeline_activity
						${whereClause}
						ORDER BY occurred_at DESC
						LIMIT ${probeLimit(page.limit)} OFFSET ${page.offset}
					`
					const { rows, hasMore } = takePage(probed, page.limit)
					const total = yield* resolveTotal(
						page,
						rows,
						() => sql<{ readonly count: string | number }>`
							SELECT count(*) AS count FROM timeline_activity
							${whereClause}
						`,
					)
					const items = yield* decodeActivities(rows)
					return {
						items,
						total,
						limit: page.limit,
						offset: page.offset,
						hasMore,
					}
				}).pipe(Effect.orDie),
			)
		}),
)
