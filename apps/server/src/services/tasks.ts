import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BadRequest, Conflict, CurrentOrg, NotFound } from '@batuda/controllers'
import { Task } from '@batuda/domain'

import { resolvePageTotal } from '../lib/sql-pagination'
import {
	TaskCompleted,
	TaskCreated,
	TaskUpdated,
	TimelineActivityService,
} from './timeline-activity'

const decodeTask = Schema.decodeUnknownEffect(Task)
const decodeTasks = Schema.decodeUnknownEffect(Schema.Array(Task))

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
	readonly shelf?: TaskShelfName | undefined
	readonly boundaries?: TaskDayBoundaries | undefined
	readonly search?: string | undefined
}

// A task belongs to exactly one shelf, so the same name serves the list and
// the count.
export type TaskShelfName =
	| 'overdue'
	| 'today'
	| 'thisWeek'
	| 'later'
	| 'noDue'
	| 'snoozed'
	| 'doneRecent'

// The edges of the reader's own day and week, as instants. They come from the
// browser because the server has no idea which timezone the reader is in, and
// "today" is a different stretch of time in each one.
export interface TaskDayBoundaries {
	readonly todayStart: string
	readonly todayEnd: string
	readonly weekEnd: string
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

// Fields a PATCH can change. The caller decodes the wire payload into this
// shape (dates already converted to Date); the service maps it to columns and
// keeps the status ⇔ completed_at invariant.
export interface TaskUpdateInput {
	readonly title?: string | undefined
	readonly notes?: string | null | undefined
	readonly status?: string | undefined
	readonly priority?: string | undefined
	readonly assigneeId?: string | null | undefined
	readonly dueAt?: Date | null | undefined
	readonly snoozedUntil?: Date | null | undefined
	readonly companyId?: string | null | undefined
	readonly contactId?: string | null | undefined
	readonly metadata?: unknown
}

// Columns read back from a write to build the timeline event. Result names
// are camelCase (PgClient transformResultNames), so this mirrors the row as
// returned, not the snake_case columns.
interface TaskRow {
	readonly id: string
	readonly organizationId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly title: string
	readonly type: string
}

// Persistence shared by the HTTP `tasks` handler and the MCP task toolkit.
// Writes funnel through here so the `organization_id` stamp lives in one
// place: the column is NOT NULL with no DB default, and the org_isolation
// RLS policy's WITH CHECK rejects a row whose organization_id doesn't match
// the active org GUC. Reads share one filter builder so `completed`/snooze
// semantics can't drift between the two transports.
export class TaskService extends Context.Service<TaskService>()('TaskService', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService

		// Work still in play: nobody has finished it, nobody has called it off,
		// and it is not sleeping until a later date.
		const waiting = sql`status NOT IN ('done', 'cancelled')
			AND (snoozed_until IS NULL OR snoozed_until <= now())`

		// Where one shelf begins and ends. Listing a shelf and counting it both
		// come through here, so a number on the rail and the rows underneath it
		// can never describe different sets of tasks.
		const shelfCondition = (
			shelf: TaskShelfName,
			boundaries: TaskDayBoundaries,
		): Statement.Fragment => {
			switch (shelf) {
				case 'overdue':
					return sql`${waiting} AND due_at < ${boundaries.todayStart}`
				case 'today':
					return sql`${waiting} AND due_at >= ${boundaries.todayStart}
						AND due_at <= ${boundaries.todayEnd}`
				case 'thisWeek':
					return sql`${waiting} AND due_at > ${boundaries.todayEnd}
						AND due_at <= ${boundaries.weekEnd}`
				case 'later':
					return sql`${waiting} AND due_at > ${boundaries.weekEnd}`
				case 'noDue':
					return sql`${waiting} AND due_at IS NULL`
				case 'snoozed':
					return sql`status = 'open' AND snoozed_until > now()`
				case 'doneRecent':
					return sql`status = 'done'
						AND completed_at >= now() - interval '7 days'`
			}
		}

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
			if (filters.priority) conditions.push(sql`priority = ${filters.priority}`)
			if (filters.source) conditions.push(sql`source = ${filters.source}`)
			if (filters.dueAfter) conditions.push(sql`due_at >= ${filters.dueAfter}`)
			if (filters.dueBefore)
				conditions.push(sql`due_at <= ${filters.dueBefore}`)
			if (filters.overdueOnly)
				conditions.push(sql`due_at < now() AND status = 'open'`)
			if (filters.shelf && filters.boundaries)
				conditions.push(shelfCondition(filters.shelf, filters.boundaries))
			// Snoozed rows hide by default; includeSnoozed surfaces them. A shelf
			// already says where sleeping tasks belong, so it opts out.
			if (filters.includeSnoozed !== true && filters.shelf === undefined)
				conditions.push(sql`(snoozed_until IS NULL OR snoozed_until <= now())`)
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

		// Both stores for a non-create transition: the task_events undo trail
		// AND the company-timeline activity row. Kept together so a new
		// transition can't write one and forget the other. `record` maps a
		// `status → done` change to a task_completed activity; other diffs land
		// as task_updated.
		const recordTaskUpdate = (
			orgId: string,
			row: TaskRow,
			actor: TaskActor,
			change: Record<string, readonly [unknown, unknown]>,
		) =>
			Effect.gen(function* () {
				yield* recordEvent(orgId, row.id, actor, change)
				yield* timeline.record(
					new TaskUpdated({
						taskId: row.id,
						companyId: row.companyId,
						contactId: row.contactId,
						change,
						actorUserId: actor.id,
						actorKind: actor.kind,
						occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					}),
				)
			})

		return {
			create: (data: Record<string, unknown>, actor: TaskActor) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows =
						yield* sql<TaskRow>`INSERT INTO tasks ${sql.insert({ ...data, organizationId: currentOrg.id })} RETURNING *`.pipe(
							Effect.orDie,
						)
					const row = rows[0]
					if (row) {
						yield* recordEvent(currentOrg.id, row.id, actor, {
							kind: 'created',
						})
						yield* timeline.record(
							new TaskCreated({
								taskId: row.id,
								companyId: row.companyId,
								contactId: row.contactId,
								title: row.title,
								taskType: row.type,
								actorUserId: actor.id,
								actorKind: actor.kind,
								occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							}),
						)
					}
					return yield* decodeTasks(rows).pipe(Effect.orDie)
				}),

			list: (filters: TaskFilters, page: TaskPage) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const conditions = conditionsFor(currentOrg.id, filters)
					const order =
						page.sort === 'recent'
							? sql`COALESCE(due_at, created_at) DESC`
							: sql`due_at ASC NULLS LAST, created_at ASC`
					const rows = yield* sql<{ readonly total: string | number }>`
							SELECT *, COUNT(*) OVER () AS total FROM tasks
							WHERE ${sql.and(conditions)}
							ORDER BY ${order}
							LIMIT ${page.limit} OFFSET ${page.offset}
						`

					const total = yield* resolvePageTotal(
						rows,
						page.offset,
						() => sql<{ readonly count: string | number }>`
							SELECT count(*) AS count FROM tasks
							WHERE ${sql.and(conditions)}
						`,
					).pipe(Effect.orDie)

					const items = yield* decodeTasks(rows).pipe(Effect.orDie)
					return { items, total, limit: page.limit, offset: page.offset }
				}),

			// Every shelf sized in one pass, so the rail can show real totals
			// without fetching the tasks behind them.
			counts: (boundaries: TaskDayBoundaries) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const tally = (shelf: TaskShelfName) =>
						sql`count(*) FILTER (WHERE ${shelfCondition(shelf, boundaries)})`
					const rows = yield* sql<Record<TaskShelfName, string | number>>`
						SELECT
							${tally('overdue')} AS "overdue",
							${tally('today')} AS "today",
							${tally('thisWeek')} AS "thisWeek",
							${tally('later')} AS "later",
							${tally('noDue')} AS "noDue",
							${tally('snoozed')} AS "snoozed",
							${tally('doneRecent')} AS "doneRecent"
						FROM tasks
						WHERE organization_id = ${currentOrg.id}
					`
					const row = rows[0]
					return {
						overdue: Number(row?.overdue ?? 0),
						today: Number(row?.today ?? 0),
						thisWeek: Number(row?.thisWeek ?? 0),
						later: Number(row?.later ?? 0),
						noDue: Number(row?.noDue ?? 0),
						snoozed: Number(row?.snoozed ?? 0),
						doneRecent: Number(row?.doneRecent ?? 0),
					}
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
					const rows = yield* sql<TaskRow>`
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
					yield* timeline.record(
						new TaskCompleted({
							taskId: id,
							companyId: row.companyId,
							contactId: row.contactId,
							actorUserId: actor.id,
							actorKind: actor.kind,
							occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
						}),
					)
					return yield* decodeTask(row).pipe(Effect.orDie)
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
					const rows = yield* sql<TaskRow>`
							UPDATE tasks SET
								status = 'open',
								completed_at = NULL,
								updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
					const row = rows[0]
					if (!row) return yield* new NotFound({ entity: 'task', id })
					yield* recordTaskUpdate(currentOrg.id, row, actor, {
						status: [prior.status, 'open'],
					})
					return yield* decodeTask(row).pipe(Effect.orDie)
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
					const rows = yield* sql<TaskRow>`
							UPDATE tasks SET
								status = 'cancelled',
								completed_at = NULL,
								updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
					const row = rows[0]
					if (!row) return yield* new NotFound({ entity: 'task', id })
					yield* recordTaskUpdate(currentOrg.id, row, actor, {
						status: [existing.status, 'cancelled'],
					})
					return yield* decodeTask(row).pipe(Effect.orDie)
				}),

			snooze: (id: string, until: Date, actor: TaskActor) =>
				Effect.gen(function* () {
					// Reject past timers on both transports — a snooze into the past
					// would resurface the task immediately.
					if (until.getTime() <= Date.now())
						return yield* new BadRequest({ message: 'until_must_be_future' })
					const currentOrg = yield* CurrentOrg
					const before = yield* sql<{ snoozedUntil: string | null }>`
							SELECT snoozed_until FROM tasks
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
					const prior = before[0]
					if (!prior) return yield* new NotFound({ entity: 'task', id })
					const rows = yield* sql<TaskRow>`
							UPDATE tasks SET snoozed_until = ${until}, updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
					const row = rows[0]
					if (!row) return yield* new NotFound({ entity: 'task', id })
					yield* recordTaskUpdate(currentOrg.id, row, actor, {
						snoozedUntil: [prior.snoozedUntil, until],
					})
					return yield* decodeTask(row).pipe(Effect.orDie)
				}),

			reschedule: (id: string, dueAt: Date | null, actor: TaskActor) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const before = yield* sql<{ dueAt: string | null }>`
							SELECT due_at FROM tasks
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
					const prior = before[0]
					if (!prior) return yield* new NotFound({ entity: 'task', id })
					const rows = yield* sql<TaskRow>`
							UPDATE tasks SET due_at = ${dueAt}, updated_at = now()
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
					const row = rows[0]
					if (!row) return yield* new NotFound({ entity: 'task', id })
					yield* recordTaskUpdate(currentOrg.id, row, actor, {
						dueAt: [prior.dueAt, dueAt],
					})
					return yield* decodeTask(row).pipe(Effect.orDie)
				}),

			get: (id: string) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql`
							SELECT * FROM tasks
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
					const row = rows[0]
					if (!row) return yield* new NotFound({ entity: 'task', id })
					return yield* decodeTask(row).pipe(Effect.orDie)
				}),

			// Partial field update. `ifMatch` is the HTTP If-Match optimistic-
			// concurrency gate (the row's prior `updated_at` ISO); MCP callers
			// omit it. Free-form edits don't write the task_events/timeline trail
			// the discrete transitions do.
			update: (
				id: string,
				input: TaskUpdateInput,
				actor: TaskActor,
				ifMatch?: string,
			) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const current = yield* sql<{ updatedAt: string }>`
							SELECT updated_at FROM tasks
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
					const prior = current[0]
					if (!prior) return yield* new NotFound({ entity: 'task', id })
					// Result columns are camelCase (transformResultNames), so the
					// freshness check reads `updatedAt`, not `updated_at`.
					if (ifMatch !== undefined) {
						const fresh = new Date(prior.updatedAt).toISOString()
						if (fresh !== ifMatch)
							return yield* new Conflict({
								message: `stale_write — current updated_at ${fresh} !== If-Match ${ifMatch}`,
							})
					}

					const updates: Record<string, unknown> = {}
					if (input.title !== undefined) updates['title'] = input.title
					if (input.notes !== undefined) updates['notes'] = input.notes
					if (input.status !== undefined) updates['status'] = input.status
					if (input.priority !== undefined) updates['priority'] = input.priority
					if (input.assigneeId !== undefined)
						updates['assignee_id'] = input.assigneeId
					if (input.dueAt !== undefined) updates['due_at'] = input.dueAt
					if (input.snoozedUntil !== undefined)
						updates['snoozed_until'] = input.snoozedUntil
					if (input.companyId !== undefined)
						updates['company_id'] = input.companyId
					if (input.contactId !== undefined)
						updates['contact_id'] = input.contactId
					if (input.metadata !== undefined) updates['metadata'] = input.metadata
					// Keep status='done' ⇔ completed_at IS NOT NULL so clients don't
					// have to manage completed_at (the DB CHECK enforces it anyway).
					if (input.status !== undefined)
						updates['completed_at'] =
							input.status === 'done'
								? DateTime.toDateUtc(DateTime.nowUnsafe())
								: null
					updates['updated_at'] = DateTime.toDateUtc(DateTime.nowUnsafe())
					updates['actor_id'] = actor.id

					const updated = yield* sql`
							UPDATE tasks SET ${sql.update(updates)}
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`.pipe(Effect.orDie)
					const row = updated[0]
					if (row === undefined)
						return yield* Effect.die(new Error('task update returned no row'))
					return yield* decodeTask(row).pipe(Effect.orDie)
				}),

			bulkComplete: (ids: ReadonlyArray<string>) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					if (ids.length === 0) return { completed: 0, ids: [] as string[] }
					const rows = yield* sql<{ id: string }>`
							UPDATE tasks SET
								status = 'done',
								completed_at = COALESCE(completed_at, now()),
								updated_at = now()
							WHERE id IN ${sql.in([...ids])}
								AND organization_id = ${currentOrg.id}
							RETURNING id
						`.pipe(Effect.orDie)
					return { completed: rows.length, ids: rows.map(r => r.id) }
				}),
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
