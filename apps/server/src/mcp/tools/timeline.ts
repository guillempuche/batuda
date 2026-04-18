import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

const ListTimeline = Tool.make('list_timeline', {
	description:
		'List timeline activity for a company or contact. Covers emails, calls, meetings, documents, proposals, research runs. Filter by channel, kind, since (ISO 8601). Max 200 rows.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
		contact_id: Schema.optional(Schema.String),
		channel: Schema.optional(Schema.String),
		kind: Schema.optional(Schema.String),
		since: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
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
					const conditions: Array<Statement.Fragment> = []
					if (params.company_id)
						conditions.push(sql`company_id = ${params.company_id}`)
					if (params.contact_id)
						conditions.push(sql`contact_id = ${params.contact_id}`)
					if (params.channel) conditions.push(sql`channel = ${params.channel}`)
					if (params.kind) conditions.push(sql`kind = ${params.kind}`)
					if (params.since) {
						const since = new Date(params.since)
						if (!Number.isNaN(since.getTime())) {
							conditions.push(sql`occurred_at >= ${since}`)
						}
					}
					const limit = Math.min(params.limit ?? 50, 200)
					const whereClause =
						conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
					return yield* sql`
						SELECT * FROM timeline_activity
						${whereClause}
						ORDER BY occurred_at DESC
						LIMIT ${limit}
					`
				}).pipe(Effect.orDie),
		}
	}),
)
