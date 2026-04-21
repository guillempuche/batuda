import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

// ── Shared literals ──────────────────────────────────────────────
// The shapes here mirror the CHECK constraints in 0001_initial.ts.
// Keeping them as exported Schema.Literals rather than free-form
// strings gives the MCP client concrete enumerations to pick from.

const TaskStatus = Schema.Literals([
	'open',
	'in_progress',
	'blocked',
	'in_review',
	'done',
	'cancelled',
])

const TaskPriority = Schema.Literals(['low', 'normal', 'high'])

const TaskSource = Schema.Literals([
	'user',
	'agent',
	'webhook',
	'email',
	'booking',
])

// ── Create ───────────────────────────────────────────────────────

const CreateTask = Tool.make('create_task', {
	description:
		'Create a task. Type is free-form (follow_up|call|email|meeting|proposal|research|other are the conventional ones). Optional due_at is an ISO 8601 datetime. company_id is optional so internal work (no company) still fits the same table. Attaches to any of the linked_* fk slots when provided.',
	parameters: Schema.Struct({
		title: Schema.String,
		type: Schema.String,
		company_id: Schema.optional(Schema.NullOr(Schema.String)),
		contact_id: Schema.optional(Schema.NullOr(Schema.String)),
		notes: Schema.optional(Schema.NullOr(Schema.String)),
		due_at: Schema.optional(Schema.NullOr(Schema.String)),
		priority: Schema.optional(TaskPriority),
		source: Schema.optional(TaskSource),
		assignee_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_interaction_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_calendar_event_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_thread_link_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_proposal_id: Schema.optional(Schema.NullOr(Schema.String)),
		metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Create Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Read ─────────────────────────────────────────────────────────

const ListTasks = Tool.make('list_tasks', {
	description:
		'List tasks with filters. `completed` is a legacy convenience flag mapped to status=done. Prefer status/statuses/overdue_only/include_snoozed for richer queries. Results sort by due_at ASC NULLS LAST, then created_at ASC. Default limit 25.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
		contact_id: Schema.optional(Schema.String),
		status: Schema.optional(TaskStatus),
		statuses: Schema.optional(Schema.Array(TaskStatus)),
		priority: Schema.optional(TaskPriority),
		source: Schema.optional(TaskSource),
		assignee_id: Schema.optional(Schema.String),
		due_before: Schema.optional(Schema.String),
		due_after: Schema.optional(Schema.String),
		overdue_only: Schema.optional(Schema.Boolean),
		include_snoozed: Schema.optional(Schema.Boolean),
		completed: Schema.optional(Schema.Boolean),
		limit: Schema.optional(Schema.Number),
		offset: Schema.optional(Schema.Number),
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Tasks')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const SearchTasks = Tool.make('search_tasks', {
	description:
		'Full-text-ish search by ILIKE against title/notes. Accepts the same filters as list_tasks; `query` is the substring to match. Returns at most `limit` rows (default 25).',
	parameters: Schema.Struct({
		query: Schema.String,
		company_id: Schema.optional(Schema.String),
		assignee_id: Schema.optional(Schema.String),
		status: Schema.optional(TaskStatus),
		overdue_only: Schema.optional(Schema.Boolean),
		include_snoozed: Schema.optional(Schema.Boolean),
		source: Schema.optional(TaskSource),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'Search Tasks')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Mutations ────────────────────────────────────────────────────

const UpdateTask = Tool.make('update_task', {
	description:
		'Partially update a task. Pass only the fields you want to change; omitted fields are untouched. Preserves the `status=done <-> completed_at IS NOT NULL` invariant by rejecting writes that would break it — use complete_task / reopen_task for status transitions.',
	parameters: Schema.Struct({
		id: Schema.String,
		title: Schema.optional(Schema.String),
		type: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.NullOr(Schema.String)),
		priority: Schema.optional(TaskPriority),
		due_at: Schema.optional(Schema.NullOr(Schema.String)),
		assignee_id: Schema.optional(Schema.NullOr(Schema.String)),
		company_id: Schema.optional(Schema.NullOr(Schema.String)),
		contact_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_interaction_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_calendar_event_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_thread_link_id: Schema.optional(Schema.NullOr(Schema.String)),
		linked_proposal_id: Schema.optional(Schema.NullOr(Schema.String)),
		metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Update Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CompleteTask = Tool.make('complete_task', {
	description:
		'Mark a task as done (status=done, completed_at=now()). Idempotent — a second call on an already-done task is a no-op.',
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Complete Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const ReopenTask = Tool.make('reopen_task', {
	description:
		'Re-open a done or cancelled task (status=open, completed_at=NULL). Idempotent — re-opening an already-open task leaves the row alone.',
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Reopen Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const CancelTask = Tool.make('cancel_task', {
	description:
		'Cancel an open or in-progress task (status=cancelled). Rejects tasks whose status is already done. Use reopen_task first if you need to cancel a completed task.',
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Cancel Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const SnoozeTask = Tool.make('snooze_task', {
	description:
		'Hide a task from the active queue until `until` (ISO 8601 datetime). The row stays at status=open; list_tasks with include_snoozed=false filters it out while the timer is still in the future.',
	parameters: Schema.Struct({
		id: Schema.String,
		until: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Snooze Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const RescheduleTask = Tool.make('reschedule_task', {
	description:
		'Shortcut for update_task that just moves due_at. Pass null to clear a due date.',
	parameters: Schema.Struct({
		id: Schema.String,
		due_at: Schema.NullOr(Schema.String),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Reschedule Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const TaskTools = Toolkit.make(
	CreateTask,
	ListTasks,
	SearchTasks,
	UpdateTask,
	CompleteTask,
	ReopenTask,
	CancelTask,
	SnoozeTask,
	RescheduleTask,
)

// ── Handlers ─────────────────────────────────────────────────────
// Every read builds a Fragment[] to avoid string concatenation in the
// SQL layer. Writes stay small on purpose — the DB CHECK constraints
// enforce the status/completed_at invariant so the handler does not
// need to rehash it.

const asDate = (v: string | null | undefined): Date | null | undefined =>
	v === null ? null : v === undefined ? undefined : new Date(v)

export const TaskHandlersLive = TaskTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		const buildFilters = (params: {
			readonly company_id?: string | undefined
			readonly contact_id?: string | undefined
			readonly status?: string | undefined
			readonly statuses?: ReadonlyArray<string> | undefined
			readonly priority?: string | undefined
			readonly source?: string | undefined
			readonly assignee_id?: string | undefined
			readonly due_before?: string | undefined
			readonly due_after?: string | undefined
			readonly overdue_only?: boolean | undefined
			readonly include_snoozed?: boolean | undefined
			readonly completed?: boolean | undefined
		}): Array<Statement.Fragment> => {
			const c: Array<Statement.Fragment> = []
			if (params.company_id) c.push(sql`company_id = ${params.company_id}`)
			if (params.contact_id) c.push(sql`contact_id = ${params.contact_id}`)
			if (params.status) c.push(sql`status = ${params.status}`)
			if (params.statuses && params.statuses.length > 0)
				c.push(sql`status IN ${sql.in([...params.statuses])}`)
			if (params.priority) c.push(sql`priority = ${params.priority}`)
			if (params.source) c.push(sql`source = ${params.source}`)
			if (params.assignee_id) c.push(sql`assignee_id = ${params.assignee_id}`)
			if (params.due_before)
				c.push(sql`due_at <= ${new Date(params.due_before)}`)
			if (params.due_after) c.push(sql`due_at >= ${new Date(params.due_after)}`)
			if (params.overdue_only === true)
				c.push(sql`due_at < now() AND status = 'open'`)
			// Default: hide currently-snoozed rows. Pass include_snoozed=true
			// to see them (e.g., for the snoozed-tab in the inbox).
			if (params.include_snoozed !== true)
				c.push(sql`(snoozed_until IS NULL OR snoozed_until <= now())`)
			if (params.completed === true) c.push(sql`status = 'done'`)
			if (params.completed === false) c.push(sql`status <> 'done'`)
			return c
		}

		return {
			create_task: params =>
				Effect.gen(function* () {
					const rows = yield* sql`INSERT INTO tasks ${sql.insert({
						title: params.title,
						type: params.type,
						companyId: params.company_id ?? null,
						contactId: params.contact_id ?? null,
						notes: params.notes ?? null,
						dueAt: asDate(params.due_at ?? null),
						priority: params.priority ?? 'normal',
						source: params.source ?? 'agent',
						assigneeId: params.assignee_id ?? null,
						linkedInteractionId: params.linked_interaction_id ?? null,
						linkedCalendarEventId: params.linked_calendar_event_id ?? null,
						linkedThreadLinkId: params.linked_thread_link_id ?? null,
						linkedProposalId: params.linked_proposal_id ?? null,
						metadata:
							params.metadata !== undefined && params.metadata !== null
								? JSON.stringify(params.metadata)
								: null,
					})} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),

			list_tasks: params =>
				Effect.gen(function* () {
					const conditions = buildFilters(params)
					const limit = params.limit ?? 25
					const offset = params.offset ?? 0
					return yield* sql`
						SELECT * FROM tasks
						${conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``}
						ORDER BY due_at ASC NULLS LAST, created_at ASC
						LIMIT ${limit} OFFSET ${offset}
					`
				}).pipe(Effect.orDie),

			search_tasks: params =>
				Effect.gen(function* () {
					const conditions = buildFilters(params)
					const needle = `%${params.query.replace(/[\\%_]/g, m => '\\' + m)}%`
					conditions.push(sql`(title ILIKE ${needle} OR notes ILIKE ${needle})`)
					const limit = params.limit ?? 25
					return yield* sql`
						SELECT * FROM tasks
						WHERE ${sql.and(conditions)}
						ORDER BY due_at ASC NULLS LAST, created_at ASC
						LIMIT ${limit}
					`
				}).pipe(Effect.orDie),

			update_task: params =>
				Effect.gen(function* () {
					// Skip no-op UPDATEs so we do not touch updated_at for free.
					const fields: Record<string, unknown> = {}
					if (params.title !== undefined) fields['title'] = params.title
					if (params.type !== undefined) fields['type'] = params.type
					if (params.notes !== undefined) fields['notes'] = params.notes
					if (params.priority !== undefined)
						fields['priority'] = params.priority
					if (params.due_at !== undefined)
						fields['due_at'] = asDate(params.due_at)
					if (params.assignee_id !== undefined)
						fields['assignee_id'] = params.assignee_id
					if (params.company_id !== undefined)
						fields['company_id'] = params.company_id
					if (params.contact_id !== undefined)
						fields['contact_id'] = params.contact_id
					if (params.linked_interaction_id !== undefined)
						fields['linked_interaction_id'] = params.linked_interaction_id
					if (params.linked_calendar_event_id !== undefined)
						fields['linked_calendar_event_id'] = params.linked_calendar_event_id
					if (params.linked_thread_link_id !== undefined)
						fields['linked_thread_link_id'] = params.linked_thread_link_id
					if (params.linked_proposal_id !== undefined)
						fields['linked_proposal_id'] = params.linked_proposal_id
					if (params.metadata !== undefined)
						fields['metadata'] =
							params.metadata === null ? null : JSON.stringify(params.metadata)
					if (Object.keys(fields).length === 0) {
						const existing =
							yield* sql`SELECT * FROM tasks WHERE id = ${params.id}`
						return existing[0]
					}
					fields['updated_at'] = new Date()
					const rows = yield* sql`
						UPDATE tasks SET ${sql.update(fields)}
						WHERE id = ${params.id}
						RETURNING *
					`
					return rows[0]
				}).pipe(Effect.orDie),

			complete_task: ({ id }) =>
				Effect.gen(function* () {
					const rows = yield* sql`
						UPDATE tasks SET
							status = 'done',
							completed_at = COALESCE(completed_at, now()),
							updated_at = now()
						WHERE id = ${id}
						RETURNING *
					`
					return rows[0]
				}).pipe(Effect.orDie),

			reopen_task: ({ id }) =>
				Effect.gen(function* () {
					const rows = yield* sql`
						UPDATE tasks SET
							status = 'open',
							completed_at = NULL,
							updated_at = now()
						WHERE id = ${id}
						RETURNING *
					`
					return rows[0]
				}).pipe(Effect.orDie),

			cancel_task: ({ id }) =>
				Effect.gen(function* () {
					const rows = yield* sql`
						UPDATE tasks SET
							status = 'cancelled',
							updated_at = now()
						WHERE id = ${id} AND status <> 'done'
						RETURNING *
					`
					return rows[0]
				}).pipe(Effect.orDie),

			snooze_task: params =>
				Effect.gen(function* () {
					const until = new Date(params.until)
					const rows = yield* sql`
						UPDATE tasks SET
							snoozed_until = ${until},
							updated_at = now()
						WHERE id = ${params.id}
						RETURNING *
					`
					return rows[0]
				}).pipe(Effect.orDie),

			reschedule_task: params =>
				Effect.gen(function* () {
					const due = params.due_at === null ? null : new Date(params.due_at)
					const rows = yield* sql`
						UPDATE tasks SET
							due_at = ${due},
							updated_at = now()
						WHERE id = ${params.id}
						RETURNING *
					`
					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
