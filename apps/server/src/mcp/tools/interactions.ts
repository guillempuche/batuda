import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const LogInteraction = Tool.make('log_interaction', {
	description:
		'Log a sales interaction. Auto-updates company last_contacted_at, next_action, and next_action_at.',
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

export const InteractionTools = Toolkit.make(LogInteraction)

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
		}
	}),
)
