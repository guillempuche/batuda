import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	BadRequest,
	BatudaApi,
	Conflict,
	NotFound,
	SessionContext,
} from '@batuda/controllers'

type TaskRow = {
	readonly id: string
	readonly status: string
	readonly updated_at: string
	readonly completed_at: string | null
}

// Optimistic-concurrency gate for PATCH /tasks/:id. Compare the row's
// current `updated_at` ISO against the client's `If-Match` header; any
// drift returns 409 so the UI can resurface the fresh row instead of
// silently overwriting an agent's edit.
const requireFresh = (row: TaskRow, ifMatch: string | undefined) => {
	if (!ifMatch) return Effect.void
	const current = new Date(row.updated_at).toISOString()
	if (current === ifMatch) return Effect.void
	return Effect.fail(
		new Conflict({
			message: `stale_write — current updated_at ${current} !== If-Match ${ifMatch}`,
		}),
	)
}

export const TasksLive = HttpApiBuilder.group(BatudaApi, 'tasks', handlers =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return handlers
			.handle('list', _ =>
				Effect.gen(function* () {
					const conditions: Array<Statement.Fragment> = []
					if (_.query.companyId)
						conditions.push(sql`company_id = ${_.query.companyId}`)
					if (_.query.contactId)
						conditions.push(sql`contact_id = ${_.query.contactId}`)
					if (_.query.assigneeId)
						conditions.push(sql`assignee_id = ${_.query.assigneeId}`)
					if (_.query.status) conditions.push(sql`status = ${_.query.status}`)
					if (_.query.priority)
						conditions.push(sql`priority = ${_.query.priority}`)
					if (_.query.source) conditions.push(sql`source = ${_.query.source}`)
					if (_.query.dueFrom)
						conditions.push(sql`due_at >= ${_.query.dueFrom}`)
					if (_.query.dueTo) conditions.push(sql`due_at <= ${_.query.dueTo}`)
					if (_.query.overdueOnly === 'true')
						conditions.push(sql`due_at < now() AND status = 'open'`)
					if (_.query.includeSnoozed !== 'true')
						conditions.push(
							sql`(snoozed_until IS NULL OR snoozed_until <= now())`,
						)
					if (_.query.search)
						conditions.push(sql`title ILIKE ${`%${_.query.search}%`}`)
					if (_.query.completed === 'true')
						conditions.push(sql`status = 'done'`)
					else if (_.query.completed === 'false')
						conditions.push(sql`status NOT IN ('done', 'cancelled')`)

					const limit = _.query.limit ?? 50
					const offset = _.query.offset ?? 0

					return yield* sql`
						SELECT * FROM tasks
						${conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``}
						ORDER BY COALESCE(due_at, created_at) DESC
						LIMIT ${limit} OFFSET ${offset}
					`
				}).pipe(Effect.orDie),
			)
			.handle('get', _ =>
				Effect.gen(function* () {
					const rows = yield* sql<TaskRow>`
						SELECT * FROM tasks WHERE id = ${_.params.id} LIMIT 1
					`
					if (rows.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					return rows[0]
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
					),
				),
			)
			.handle('create', _ =>
				Effect.gen(function* () {
					const { userId: actorId } = yield* SessionContext
					const rows = yield* sql`
						INSERT INTO tasks ${sql.insert({
							company_id: _.payload.companyId ?? null,
							contact_id: _.payload.contactId ?? null,
							type: _.payload.type,
							title: _.payload.title,
							notes: _.payload.notes ?? null,
							status: _.payload.status ?? 'open',
							source: _.payload.source ?? 'user',
							priority: _.payload.priority ?? 'normal',
							assignee_id: _.payload.assigneeId ?? actorId,
							actor_id: actorId,
							due_at: _.payload.dueAt
								? DateTime.toDateUtc(_.payload.dueAt)
								: null,
							linked_interaction_id: _.payload.linkedInteractionId ?? null,
							linked_calendar_event_id: _.payload.linkedCalendarEventId ?? null,
							linked_thread_link_id: _.payload.linkedThreadLinkId ?? null,
							linked_proposal_id: _.payload.linkedProposalId ?? null,
							metadata: _.payload.metadata ?? null,
						})} RETURNING *
					`
					yield* Effect.logInfo('Task created').pipe(
						Effect.annotateLogs({
							event: 'task.created',
							taskId: (rows[0] as { id: string } | undefined)?.id,
						}),
					)
					return rows[0]
				}).pipe(Effect.orDie),
			)
			.handle('update', _ =>
				Effect.gen(function* () {
					const current = yield* sql<TaskRow>`
						SELECT * FROM tasks WHERE id = ${_.params.id} LIMIT 1
					`
					if (current.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					const row = current[0]!
					yield* requireFresh(row, _.headers['if-match'])

					const updates: Record<string, unknown> = {}
					if (_.payload.title !== undefined) updates['title'] = _.payload.title
					if (_.payload.notes !== undefined) updates['notes'] = _.payload.notes
					if (_.payload.status !== undefined)
						updates['status'] = _.payload.status
					if (_.payload.priority !== undefined)
						updates['priority'] = _.payload.priority
					if (_.payload.assigneeId !== undefined)
						updates['assignee_id'] = _.payload.assigneeId
					if (_.payload.dueAt !== undefined)
						updates['due_at'] = _.payload.dueAt
							? DateTime.toDateUtc(_.payload.dueAt)
							: null
					if (_.payload.snoozedUntil !== undefined)
						updates['snoozed_until'] = _.payload.snoozedUntil
							? DateTime.toDateUtc(_.payload.snoozedUntil)
							: null
					if (_.payload.companyId !== undefined)
						updates['company_id'] = _.payload.companyId
					if (_.payload.contactId !== undefined)
						updates['contact_id'] = _.payload.contactId
					if (_.payload.metadata !== undefined)
						updates['metadata'] = _.payload.metadata

					// Keep the invariant: status='done' ⇔ completed_at IS NOT NULL.
					// The DB CHECK would reject violations anyway, but updating
					// `completed_at` here means clients don't have to know about it.
					if (_.payload.status !== undefined) {
						updates['completed_at'] =
							_.payload.status === 'done' ? new Date() : null
					}
					updates['updated_at'] = new Date()
					updates['actor_id'] = (yield* SessionContext).userId

					const updated = yield* sql`
						UPDATE tasks SET ${sql.update(updates)}
						WHERE id = ${_.params.id} RETURNING *
					`
					return updated[0]
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' || e._tag === 'Conflict'
							? Effect.fail(e)
							: Effect.die(e),
					),
				),
			)
			.handle('complete', _ =>
				Effect.gen(function* () {
					const rows = yield* sql<TaskRow>`
						UPDATE tasks SET
							status = 'done',
							completed_at = COALESCE(completed_at, now()),
							updated_at = now()
						WHERE id = ${_.params.id} RETURNING *
					`
					if (rows.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					return rows[0]
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
					),
				),
			)
			.handle('reopen', _ =>
				Effect.gen(function* () {
					const rows = yield* sql<TaskRow>`
						UPDATE tasks SET
							status = 'open',
							completed_at = NULL,
							updated_at = now()
						WHERE id = ${_.params.id} RETURNING *
					`
					if (rows.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					return rows[0]
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
					),
				),
			)
			.handle('cancel', _ =>
				Effect.gen(function* () {
					const current = yield* sql<TaskRow>`
						SELECT * FROM tasks WHERE id = ${_.params.id} LIMIT 1
					`
					if (current.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					if (current[0]!.status === 'done')
						return yield* new Conflict({ message: 'cannot_cancel_done_task' })
					const rows = yield* sql`
						UPDATE tasks SET
							status = 'cancelled',
							completed_at = NULL,
							updated_at = now()
						WHERE id = ${_.params.id} RETURNING *
					`
					return rows[0]
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' || e._tag === 'Conflict'
							? Effect.fail(e)
							: Effect.die(e),
					),
				),
			)
			.handle('snooze', _ =>
				Effect.gen(function* () {
					const until = DateTime.toDateUtc(_.payload.until)
					if (until.getTime() <= Date.now())
						return yield* new BadRequest({ message: 'until_must_be_future' })
					const rows = yield* sql<TaskRow>`
						UPDATE tasks SET
							snoozed_until = ${until},
							updated_at = now()
						WHERE id = ${_.params.id} RETURNING *
					`
					if (rows.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					return rows[0]
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' || e._tag === 'BadRequest'
							? Effect.fail(e)
							: Effect.die(e),
					),
				),
			)
			.handle('reschedule', _ =>
				Effect.gen(function* () {
					const dueAt = _.payload.dueAt
						? DateTime.toDateUtc(_.payload.dueAt)
						: null
					const rows = yield* sql<TaskRow>`
						UPDATE tasks SET
							due_at = ${dueAt},
							updated_at = now()
						WHERE id = ${_.params.id} RETURNING *
					`
					if (rows.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					return rows[0]
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
					),
				),
			)
			.handle('bulkComplete', _ =>
				Effect.gen(function* () {
					const rows = yield* sql`
						UPDATE tasks SET
							status = 'done',
							completed_at = COALESCE(completed_at, now()),
							updated_at = now()
						WHERE id IN ${sql.in(_.payload.ids)} RETURNING id
					`
					return {
						completed: rows.length,
						ids: rows.map(r => (r as { id: string }).id),
					}
				}).pipe(Effect.orDie),
			)
			.handle('events', _ =>
				Effect.gen(function* () {
					const exists = yield* sql<TaskRow>`
						SELECT id FROM tasks WHERE id = ${_.params.id} LIMIT 1
					`
					if (exists.length === 0)
						return yield* new NotFound({ entity: 'task', id: _.params.id })
					return yield* sql`
						SELECT * FROM task_events WHERE task_id = ${_.params.id}
						ORDER BY at DESC LIMIT 100
					`
				}).pipe(
					Effect.catch(e =>
						e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
					),
				),
			)
	}),
)
