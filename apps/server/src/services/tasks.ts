import { Effect, Layer, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BadRequest, Conflict, CurrentOrg, NotFound } from '@batuda/controllers'

export interface TaskFilters {
	readonly companyId?: string | undefined
	readonly contactId?: string | undefined
	readonly assigneeId?: string | undefined
	readonly status?: string | undefined
	readonly statuses?: ReadonlyArray<string> | undefined
	readonly priority?: string | undefined
	readonly source?: string | undefined
	readonly dueAfter?: string | undefined
	readonly dueBefore?: string | undefined
	readonly overdueOnly?: boolean | undefined
	readonly includeSnoozed?: boolean | undefined
	readonly completed?: boolean | undefined
	readonly search?: string | undefined
}

// `recent` surfaces newest-first for the web inbox; `due` surfaces the most
// overdue first for an agent picking the next thing to act on.
export type TaskSort = 'recent' | 'due'

export interface TaskPage {
	readonly sort: TaskSort
	readonly limit: number
	readonly offset: number
}

// Who performed a write, recorded on the task_events audit trail. `kind`
// satisfies the actor_kind NOT NULL check; `id` is null for agent-driven MCP
// writes, which carry no individual user.
export interface TaskActor {
	readonly id: string | null
	readonly kind: 'user' | 'agent'
}

// Persistence shared by the HTTP `tasks` handler and the MCP task toolkit.
// Writes funnel through here so the `organization_id` stamp lives in one
// place: the column is NOT NULL with no DB default, and the org_isolation
// RLS policy's WITH CHECK rejects a row whose organization_id doesn't match
// the active org GUC. Reads share one filter builder so `completed`/snooze
// semantics can't drift between the two transports.
export class TaskService extends ServiceMap.Service<TaskService>()(
	'TaskService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			const conditionsFor = (
				orgId: string,
				filters: TaskFilters,
			): Array<Statement.Fragment> => {
				const conditions: Array<Statement.Fragment> = [
					sql`organization_id = ${orgId}`,
				]
				if (filters.companyId)
					conditions.push(sql`company_id = ${filters.companyId}`)
				if (filters.contactId)
					conditions.push(sql`contact_id = ${filters.contactId}`)
				if (filters.assigneeId)
					conditions.push(sql`assignee_id = ${filters.assigneeId}`)
				if (filters.status) conditions.push(sql`status = ${filters.status}`)
				if (filters.statuses && filters.statuses.length > 0)
					conditions.push(sql`status IN ${sql.in([...filters.statuses])}`)
				if (filters.priority)
					conditions.push(sql`priority = ${filters.priority}`)
				if (filters.source) conditions.push(sql`source = ${filters.source}`)
				if (filters.dueAfter)
					conditions.push(sql`due_at >= ${filters.dueAfter}`)
				if (filters.dueBefore)
					conditions.push(sql`due_at <= ${filters.dueBefore}`)
				if (filters.overdueOnly)
					conditions.push(sql`due_at < now() AND status = 'open'`)
				// Snoozed rows hide by default; includeSnoozed surfaces them.
				if (filters.includeSnoozed !== true)
					conditions.push(
						sql`(snoozed_until IS NULL OR snoozed_until <= now())`,
					)
				// `completed=false` excludes cancelled as well as done — a cancelled
				// task is not open work. Shared by both transports so the meaning of
				// the flag can't drift.
				if (filters.completed === true) conditions.push(sql`status = 'done'`)
				if (filters.completed === false)
					conditions.push(sql`status NOT IN ('done', 'cancelled')`)
				if (filters.search) {
					const needle = `%${filters.search.replace(/[\\%_]/g, match => `\\${match}`)}%`
					conditions.push(sql`(title ILIKE ${needle} OR notes ILIKE ${needle})`)
				}
				return conditions
			}

			// Append-only audit row consumed by the tasks-inbox undo drawer
			// (`apps/internal` reads it via GET /tasks/:id/events). `change` is a
			// field diff (`{ field: [old, new] }`) or `{ kind: 'created' }`.
			const recordEvent = (
				orgId: string,
				taskId: string,
				actor: TaskActor,
				change: Record<string, unknown>,
			) =>
				sql`INSERT INTO task_events ${sql.insert({
					organizationId: orgId,
					taskId,
					actorId: actor.id,
					actorKind: actor.kind,
					change: JSON.stringify(change),
				})}`.pipe(Effect.orDie, Effect.asVoid)

			return {
				create: (data: Record<string, unknown>, actor: TaskActor) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql<{
							id: string
						}>`INSERT INTO tasks ${sql.insert({ ...data, organizationId: currentOrg.id })} RETURNING *`.pipe(
							Effect.orDie,
						)
						const row = rows[0]
						if (row)
							yield* recordEvent(currentOrg.id, row.id, actor, {
								kind: 'created',
							})
						return rows
					}),

				list: (filters: TaskFilters, page: TaskPage) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const conditions = conditionsFor(currentOrg.id, filters)
						const order =
							page.sort === 'recent'
								? sql`COALESCE(due_at, created_at) DESC`
								: sql`due_at ASC NULLS LAST, created_at ASC`
						return yield* sql`
							SELECT * FROM tasks
							WHERE ${sql.and(conditions)}
							ORDER BY ${order}
							LIMIT ${page.limit} OFFSET ${page.offset}
						`
					}),

				complete: (id: string, actor: TaskActor) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const before = yield* sql<{ status: string }>`
							SELECT status FROM tasks
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
						const prior = before[0]
						if (!prior) return yield* new NotFound({ entity: 'task', id })
						const rows = yield* sql<{ id: string }>`
							UPDATE tasks SET
								status = 'done',
								completed_at = COALESCE(completed_at, now()),
								updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row) return yield* new NotFound({ entity: 'task', id })
						yield* recordEvent(currentOrg.id, id, actor, {
							status: [prior.status, 'done'],
						})
						return row
					}),

				reopen: (id: string, actor: TaskActor) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const before = yield* sql<{ status: string }>`
							SELECT status FROM tasks
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
						const prior = before[0]
						if (!prior) return yield* new NotFound({ entity: 'task', id })
						const rows = yield* sql<{ id: string }>`
							UPDATE tasks SET
								status = 'open',
								completed_at = NULL,
								updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row) return yield* new NotFound({ entity: 'task', id })
						yield* recordEvent(currentOrg.id, id, actor, {
							status: [prior.status, 'open'],
						})
						return row
					}),

				cancel: (id: string, actor: TaskActor) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const current = yield* sql<{ status: string }>`
							SELECT status FROM tasks
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
						const existing = current[0]
						if (!existing) return yield* new NotFound({ entity: 'task', id })
						// A done task can't be cancelled — reopen it first. Enforced on
						// both transports; the MCP tool previously no-op'd silently.
						if (existing.status === 'done')
							return yield* new Conflict({ message: 'cannot_cancel_done_task' })
						// Clearing completed_at keeps the done ⇔ completed_at invariant:
						// only status='done' may carry one (tasks_completed_at_matches_status).
						const rows = yield* sql<{ id: string }>`
							UPDATE tasks SET
								status = 'cancelled',
								completed_at = NULL,
								updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row) return yield* new NotFound({ entity: 'task', id })
						yield* recordEvent(currentOrg.id, id, actor, {
							status: [existing.status, 'cancelled'],
						})
						return row
					}),

				snooze: (id: string, until: Date) =>
					Effect.gen(function* () {
						// Reject past timers on both transports — a snooze into the past
						// would resurface the task immediately.
						if (until.getTime() <= Date.now())
							return yield* new BadRequest({ message: 'until_must_be_future' })
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql<{ id: string }>`
							UPDATE tasks SET snoozed_until = ${until}, updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row) return yield* new NotFound({ entity: 'task', id })
						return row
					}),

				reschedule: (id: string, dueAt: Date | null) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql<{ id: string }>`
							UPDATE tasks SET due_at = ${dueAt}, updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row) return yield* new NotFound({ entity: 'task', id })
						return row
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
