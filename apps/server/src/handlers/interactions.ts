import { DateTime, Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '@batuda/controllers'
import { Interaction } from '@batuda/domain'

import {
	pageOf,
	probeLimit,
	resolveTotal,
	takePage,
	totalColumn,
} from '../lib/sql-pagination'
import {
	InteractionLogged,
	TimelineActivityService,
} from '../services/timeline-activity'

const decodeInteraction = Schema.decodeUnknownEffect(Interaction)
const decodeInteractions = Schema.decodeUnknownEffect(Schema.Array(Interaction))

export const InteractionsLive = HttpApiBuilder.group(
	BatudaApi,
	'interactions',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const timeline = yield* TimelineActivityService
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const page = pageOf(_.query, 20)
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`company_id = ${_.query.companyId}`)
						const probed = yield* sql<{ readonly total?: string | number }>`
							SELECT *${totalColumn(sql, page.count)} FROM interactions
							WHERE ${sql.and(conditions)}
							ORDER BY date DESC
							LIMIT ${probeLimit(page.limit)} OFFSET ${page.offset}
						`
						const { rows, hasMore } = takePage(probed, page.limit)
						const total = yield* resolveTotal(
							page,
							rows,
							() => sql<{ readonly count: string | number }>`
								SELECT count(*) AS count FROM interactions
								WHERE ${sql.and(conditions)}
							`,
						)
						const items = yield* decodeInteractions(rows)
						return {
							items,
							total,
							limit: page.limit,
							offset: page.offset,
							hasMore,
						}
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const payload = _.payload as {
							companyId: string
							contactId?: string
							date?: DateTime.Utc
							durationMin?: number
							channel: string
							direction: string
							type: string
							subject?: string
							summary?: string
							outcome?: string
							nextAction?: string
							nextActionAt?: string
							metadata?: unknown
						}

						const occurredAt = payload.date
							? DateTime.toDateUtc(payload.date)
							: DateTime.toDateUtc(DateTime.nowUnsafe())
						const nextActionAt = payload.nextActionAt
							? new Date(payload.nextActionAt)
							: null

						const { interactionId } = yield* timeline.record(
							new InteractionLogged({
								companyId: payload.companyId,
								contactId: payload.contactId ?? null,
								channel: payload.channel,
								direction: payload.direction as 'inbound' | 'outbound',
								type: payload.type,
								subject: payload.subject ?? null,
								summary: payload.summary ?? null,
								outcome: payload.outcome ?? null,
								nextAction: payload.nextAction ?? null,
								nextActionAt,
								durationMin: payload.durationMin ?? null,
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

						if (payload.nextAction || payload.nextActionAt) {
							const companyUpdate: Record<string, unknown> = {
								updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							}
							if (payload.nextAction)
								companyUpdate['nextAction'] = payload.nextAction
							if (nextActionAt) companyUpdate['nextActionAt'] = nextActionAt
							yield* sql`UPDATE companies SET ${sql.update(companyUpdate, ['id'])} WHERE id = ${payload.companyId}`
						}

						const rows = yield* sql`
							SELECT * FROM interactions WHERE id = ${interactionId} LIMIT 1
						`

						yield* Effect.logInfo('Interaction logged').pipe(
							Effect.annotateLogs({
								event: 'interaction.logged',
								companyId: payload.companyId,
								channel: payload.channel,
								direction: payload.direction,
							}),
						)

						return yield* decodeInteraction(rows[0])
					}).pipe(Effect.orDie),
				)
		}),
)
