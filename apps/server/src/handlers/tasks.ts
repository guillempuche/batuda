import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, NotFound, SessionContext } from '@batuda/controllers'

import { TaskService } from '../services/tasks'

export const TasksLive = HttpApiBuilder.group(BatudaApi, 'tasks', handlers =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const taskService = yield* TaskService
		return handlers
			.handle('list', _ =>
				Effect.gen(function* () {
					return yield* taskService.list(
						{
							companyId: _.query.companyId,
							contactId: _.query.contactId,
							assigneeId: _.query.assigneeId,
							status: _.query.status,
							priority: _.query.priority,
							source: _.query.source,
							dueAfter: _.query.dueFrom,
							dueBefore: _.query.dueTo,
							overdueOnly: _.query.overdueOnly === 'true',
							includeSnoozed: _.query.includeSnoozed === 'true',
							completed:
								_.query.completed === 'true'
									? true
									: _.query.completed === 'false'
										? false
										: undefined,
							search: _.query.search,
						},
						{
							sort: 'recent',
							limit: _.query.limit ?? 50,
							offset: _.query.offset ?? 0,
						},
					)
				}).pipe(Effect.orDie),
			)
			.handle('get', _ => taskService.get(_.params.id))
			.handle('create', _ =>
				Effect.gen(function* () {
					const { userId: actorId, isAgent } = yield* SessionContext
					const rows = yield* taskService.create(
						{
							company_id: _.payload.companyId ?? null,
							contact_id: _.payload.contactId ?? null,
							type: _.payload.type,
							title: _.payload.title,
							notes: _.payload.notes ?? null,
							status: _.payload.status ?? 'open',
							source: _.payload.source ?? 'user',
							priority: _.payload.priority ?? 'normal',
							assignee_id: _.payload.assigneeId ?? actorId,
							// The tasks column; the audit actor for task_events is the
							// second argument below.
							actor_id: actorId,
							due_at: _.payload.dueAt
								? DateTime.toDateUtc(_.payload.dueAt)
								: null,
							linked_interaction_id: _.payload.linkedInteractionId ?? null,
							linked_calendar_event_id: _.payload.linkedCalendarEventId ?? null,
							linked_thread_link_id: _.payload.linkedThreadLinkId ?? null,
							linked_proposal_id: _.payload.linkedProposalId ?? null,
							metadata: _.payload.metadata ?? null,
						},
						{ id: actorId, kind: isAgent ? 'agent' : 'user' },
					)
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
					const { userId, isAgent } = yield* SessionContext
					return yield* taskService.update(
						_.params.id,
						{
							title: _.payload.title,
							notes: _.payload.notes,
							status: _.payload.status,
							priority: _.payload.priority,
							assigneeId: _.payload.assigneeId,
							// undefined leaves the column untouched; explicit null clears it.
							dueAt:
								_.payload.dueAt !== undefined
									? _.payload.dueAt
										? DateTime.toDateUtc(_.payload.dueAt)
										: null
									: undefined,
							snoozedUntil:
								_.payload.snoozedUntil !== undefined
									? _.payload.snoozedUntil
										? DateTime.toDateUtc(_.payload.snoozedUntil)
										: null
									: undefined,
							companyId: _.payload.companyId,
							contactId: _.payload.contactId,
							metadata: _.payload.metadata,
						},
						{ id: userId, kind: isAgent ? 'agent' : 'user' },
						_.headers['if-match'],
					)
				}),
			)
			.handle('complete', _ =>
				Effect.gen(function* () {
					const { userId, isAgent } = yield* SessionContext
					return yield* taskService.complete(_.params.id, {
						id: userId,
						kind: isAgent ? 'agent' : 'user',
					})
				}),
			)
			.handle('reopen', _ =>
				Effect.gen(function* () {
					const { userId, isAgent } = yield* SessionContext
					return yield* taskService.reopen(_.params.id, {
						id: userId,
						kind: isAgent ? 'agent' : 'user',
					})
				}),
			)
			.handle('cancel', _ =>
				Effect.gen(function* () {
					const { userId, isAgent } = yield* SessionContext
					return yield* taskService.cancel(_.params.id, {
						id: userId,
						kind: isAgent ? 'agent' : 'user',
					})
				}),
			)
			.handle('snooze', _ =>
				Effect.gen(function* () {
					const { userId, isAgent } = yield* SessionContext
					return yield* taskService.snooze(
						_.params.id,
						DateTime.toDateUtc(_.payload.until),
						{ id: userId, kind: isAgent ? 'agent' : 'user' },
					)
				}),
			)
			.handle('reschedule', _ =>
				Effect.gen(function* () {
					const { userId, isAgent } = yield* SessionContext
					return yield* taskService.reschedule(
						_.params.id,
						_.payload.dueAt ? DateTime.toDateUtc(_.payload.dueAt) : null,
						{ id: userId, kind: isAgent ? 'agent' : 'user' },
					)
				}),
			)
			.handle('bulkComplete', _ => taskService.bulkComplete(_.payload.ids))
			.handle('events', _ =>
				Effect.gen(function* () {
					const exists = yield* sql`
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
