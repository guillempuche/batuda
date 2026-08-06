import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { TimelineActivity, TimelineEntityType } from '@batuda/domain'

import { companyVisible } from '../../services/company-liveness'
import { McpPageLimit, TruncatableResult, toTruncatable } from './_result'

const decodeActivities = Schema.decodeUnknownEffect(
	Schema.Array(TimelineActivity),
)

const ListTimeline = Tool.make('list_timeline', {
	description:
		'List timeline activity. company_id or contact_id gives a company or person their whole history; entity_type + entity_id gives one record its own — the events about a single task, proposal or meeting. Covers emails, calls, meetings, documents, proposals, research runs. Filter by channel, kind, since (ISO 8601). Returns at most `limit` rows (default 50, max 500); `hasMore` says whether more exist than were returned.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
		contact_id: Schema.optional(Schema.String),
		entity_type: Schema.optional(TimelineEntityType),
		entity_id: Schema.optional(Schema.String),
		channel: Schema.optional(Schema.String),
		kind: Schema.optional(Schema.String),
		since: Schema.optional(Schema.String),
		limit: Schema.optional(McpPageLimit),
	}),
	success: TruncatableResult(TimelineActivity.json),
})
	.annotate(Tool.Title, 'List Timeline')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const TimelineTools = Toolkit.make(ListTimeline)

export const TimelineHandlersLive = TimelineTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			list_timeline: params =>
				Effect.gen(function* () {
					const conditions: Array<Statement.Fragment> = [
						// History belonging to a company nobody can open goes with it.
						companyVisible(sql, sql`company_id`),
					]
					if (params.company_id)
						conditions.push(sql`company_id = ${params.company_id}`)
					if (params.contact_id)
						conditions.push(sql`contact_id = ${params.contact_id}`)
					// Both together, or neither: an id means nothing without the
					// kind of record it belongs to.
					if (params.entity_type && params.entity_id) {
						conditions.push(
							sql`entity_type = ${params.entity_type} AND entity_id = ${params.entity_id}`,
						)
					}
					if (params.channel) conditions.push(sql`channel = ${params.channel}`)
					if (params.kind) conditions.push(sql`kind = ${params.kind}`)
					if (params.since) {
						const since = new Date(params.since)
						if (!Number.isNaN(since.getTime())) {
							conditions.push(sql`occurred_at >= ${since}`)
						}
					}
					const limit = params.limit ?? 50
					const whereClause =
						conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
					const rows = yield* sql`
						SELECT * FROM timeline_activity
						${whereClause}
						ORDER BY occurred_at DESC
						LIMIT ${limit + 1}
					`
					return toTruncatable(yield* decodeActivities(rows), limit)
				}).pipe(Effect.orDie),
		}
	}),
)
