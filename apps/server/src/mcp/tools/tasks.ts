import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import { TaskService } from '../../services/tasks'

// MCP writes are agent-driven; task_events records actor_kind='agent' with no
// individual user id.
const AGENT_ACTOR = { id: null, kind: 'agent' as const }

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
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Create Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Read ─────────────────────────────────────────────────────────

const ListTasks = Tool.make('list_tasks', {
	description:
		'List tasks with filters. `completed=true` maps to status=done; `completed=false` returns open work (excludes done AND cancelled). Prefer status/statuses/overdue_only/include_snoozed for richer queries. Results sort by due_at ASC NULLS LAST, then created_at ASC. Default limit 25.',
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
	dependencies: [CurrentOrg],
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
	dependencies: [CurrentOrg],
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
	dependencies: [CurrentOrg],
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
	dependencies: [CurrentOrg],
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
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Cancel Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const SnoozeTask = Tool.make('snooze_task', {
	description:
		'Hide a task from the active queue until `until` (ISO 8601 datetime). The row stays at status=open; list_tasks with include_snoozed=false filters it out while the timer is still in the future. `until` must be a future timestamp.',
	parameters: Schema.Struct({
		id: Schema.String,
		until: Schema.String,
	}),
	success: Schema.Unknown,
	dependencies: [CurrentOrg],
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
	dependencies: [CurrentOrg],
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
// Reads delegate to TaskService.list so filter semantics stay identical
// to the HTTP transport. Writes stay small on purpose — the DB CHECK
// constraints enforce the status/completed_at invariant so the handler
// does not need to rehash it.

const asDate = (v: string | null | undefined): Date | null | undefined =>
	v === null ? null : v === undefined ? undefined : new Date(v)

export const TaskHandlersLive = TaskTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const taskService = yield* TaskService

		return {
			create_task: params =>
				Effect.gen(function* () {
					const rows = yield* taskService.create(
						{
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
						},
						AGENT_ACTOR,
					)
					return rows[0]
				}).pipe(Effect.orDie),

			list_tasks: params =>
				taskService
					.list(
						{
							companyId: params.company_id,
							contactId: params.contact_id,
							assigneeId: params.assignee_id,
							status: params.status,
							statuses: params.statuses,
							priority: params.priority,
							source: params.source,
							dueAfter: params.due_after,
							dueBefore: params.due_before,
							overdueOnly: params.overdue_only,
							includeSnoozed: params.include_snoozed,
							completed: params.completed,
						},
						{
							sort: 'due',
							limit: params.limit ?? 25,
							offset: params.offset ?? 0,
						},
					)
					.pipe(Effect.orDie),

			search_tasks: params =>
				taskService
					.list(
						{
							companyId: params.company_id,
							assigneeId: params.assignee_id,
							status: params.status,
							source: params.source,
							overdueOnly: params.overdue_only,
							includeSnoozed: params.include_snoozed,
							search: params.query,
						},
						{ sort: 'due', limit: params.limit ?? 25, offset: 0 },
					)
					.pipe(Effect.orDie),

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
				taskService.complete(id, AGENT_ACTOR).pipe(
					Effect.catchTag('NotFound', () => Effect.succeed(null)),
					Effect.orDie,
				),

			reopen_task: ({ id }) =>
				taskService.reopen(id, AGENT_ACTOR).pipe(
					Effect.catchTag('NotFound', () => Effect.succeed(null)),
					Effect.orDie,
				),

			cancel_task: ({ id }) =>
				taskService.cancel(id, AGENT_ACTOR).pipe(
					Effect.catchTag('NotFound', () => Effect.succeed(null)),
					Effect.orDie,
				),

			snooze_task: params =>
				taskService.snooze(params.id, new Date(params.until)).pipe(
					Effect.catchTag('NotFound', () => Effect.succeed(null)),
					Effect.orDie,
				),

			reschedule_task: params =>
				taskService
					.reschedule(
						params.id,
						params.due_at === null ? null : new Date(params.due_at),
					)
					.pipe(
						Effect.catchTag('NotFound', () => Effect.succeed(null)),
						Effect.orDie,
					),
		}
	}),
)
