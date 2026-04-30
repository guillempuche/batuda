import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import {
	InteractionLogged,
	TimelineActivityService,
} from '../../services/timeline-activity'

const REQUEST_DEPENDENCIES = [CurrentOrg]

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
	dependencies: REQUEST_DEPENDENCIES,
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
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Interactions')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const InteractionTools = Toolkit.make(LogInteraction, ListInteractions)

// MCP channel 'in_person' normalises to 'visit' so the cadence column picker
// lands on last_meeting_at. The rest of the MCP vocabulary is already aligned
// with the interactions schema.
const normaliseChannel = (channel: string): string =>
	channel === 'in_person' ? 'visit' : channel

export const InteractionHandlersLive = InteractionTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService
		return {
			log_interaction: params =>
				Effect.gen(function* () {
					const occurredAt = new Date()
					const nextActionAt = params.next_action_at
						? new Date(params.next_action_at)
						: null

					const { interactionId } = yield* timeline.record(
						new InteractionLogged({
							companyId: params.company_id,
							contactId: params.contact_id ?? null,
							channel: normaliseChannel(params.channel),
							direction: params.direction as 'inbound' | 'outbound',
							type: params.type,
							subject: params.subject ?? null,
							summary: params.summary ?? null,
							outcome: params.outcome ?? null,
							nextAction: params.next_action ?? null,
							nextActionAt,
							durationMin: params.duration_min ?? null,
							occurredAt,
							actorUserId: null,
							attachInteractionId: null,
						}),
					)

					if (!interactionId) {
						return yield* Effect.die(
							new Error(
								'TimelineActivityService produced no interactionId for InteractionLogged',
							),
						)
					}

					if (params.next_action || nextActionAt) {
						const companyUpdate: Record<string, unknown> = {
							updatedAt: new Date(),
						}
						if (params.next_action)
							companyUpdate['nextAction'] = params.next_action
						if (nextActionAt) companyUpdate['nextActionAt'] = nextActionAt
						yield* sql`UPDATE companies SET ${sql.update(companyUpdate, [])} WHERE id = ${params.company_id}`
					}

					const rows = yield* sql`
						SELECT * FROM interactions WHERE id = ${interactionId} LIMIT 1
					`
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
