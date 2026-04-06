import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const LogInteraction = Tool.make('log_interaction', {
	description:
		'Log a sales interaction. Channel: email|phone|whatsapp|linkedin|instagram|in_person|other. Direction: inbound|outbound. Type: call|email|meeting|demo|follow_up|other. Auto-updates company last_contacted_at and next_action.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		contact_id: Schema.optional(Schema.String),
		channel: Schema.String,
		direction: Schema.String,
		type: Schema.String,
		subject: Schema.optional(Schema.String),
		summary: Schema.optional(Schema.String),
		outcome: Schema.optional(Schema.String),
		next_action: Schema.optional(Schema.String),
		next_action_at: Schema.optional(Schema.String),
		duration_min: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Log Interaction')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ListInteractions = Tool.make('list_interactions', {
	description:
		'List interactions for a company, newest first. Optionally filter by channel or type.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		channel: Schema.optional(Schema.String),
		type: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'List Interactions')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const InteractionTools = Toolkit.make(LogInteraction, ListInteractions)

export const InteractionHandlersLive = InteractionTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			log_interaction: params =>
				Effect.gen(function* () {
					const rows = yield* sql`INSERT INTO interactions ${sql.insert({
						companyId: params.company_id,
						contactId: params.contact_id,
						channel: params.channel,
						direction: params.direction,
						type: params.type,
						subject: params.subject,
						summary: params.summary,
						outcome: params.outcome,
						nextAction: params.next_action,
						nextActionAt: params.next_action_at,
						durationMin: params.duration_min,
						date: new Date(),
					})} RETURNING *`

					const companyUpdate: Record<string, unknown> = {
						lastContactedAt: new Date(),
						updatedAt: new Date(),
					}
					if (params.next_action)
						companyUpdate['nextAction'] = params.next_action
					if (params.next_action_at)
						companyUpdate['nextActionAt'] = new Date(params.next_action_at)

					yield* sql`UPDATE companies SET ${sql.update(companyUpdate, [])} WHERE id = ${params.company_id}`

					return rows[0]
				}).pipe(Effect.orDie),
			list_interactions: params =>
				Effect.gen(function* () {
					const conditions = [sql`company_id = ${params.company_id}`]
					if (params.channel) conditions.push(sql`channel = ${params.channel}`)
					if (params.type) conditions.push(sql`type = ${params.type}`)
					const limit = params.limit ?? 20
					return yield* sql`SELECT * FROM interactions WHERE ${sql.and(conditions)} ORDER BY date DESC LIMIT ${limit}`
				}).pipe(Effect.orDie),
		}
	}),
)
