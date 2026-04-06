import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const CreateTask = Tool.make('create_task', {
	description:
		'Create a follow-up task for a company. Type: follow_up|call|email|meeting|proposal|research|other. due_at: ISO 8601 datetime.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		contact_id: Schema.optional(Schema.String),
		type: Schema.String,
		title: Schema.String,
		notes: Schema.optional(Schema.String),
		due_at: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Create Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ListTasks = Tool.make('list_tasks', {
	description: 'List tasks for a company. Filter by completion status.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		completed: Schema.optional(Schema.Boolean),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'List Tasks')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CompleteTask = Tool.make('complete_task', {
	description:
		'Mark a task as completed (sets completed_at to now). Idempotent — safe to call multiple times.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Complete Task')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const TaskTools = Toolkit.make(CreateTask, ListTasks, CompleteTask)

export const TaskHandlersLive = TaskTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			create_task: params =>
				Effect.gen(function* () {
					const rows = yield* sql`INSERT INTO tasks ${sql.insert({
						companyId: params.company_id,
						contactId: params.contact_id,
						type: params.type,
						title: params.title,
						notes: params.notes,
						dueAt: params.due_at ? new Date(params.due_at) : undefined,
					})} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
			list_tasks: params =>
				Effect.gen(function* () {
					const conditions = [sql`company_id = ${params.company_id}`]
					if (params.completed === true)
						conditions.push(sql`completed_at IS NOT NULL`)
					if (params.completed === false)
						conditions.push(sql`completed_at IS NULL`)
					const limit = params.limit ?? 20
					return yield* sql`SELECT * FROM tasks WHERE ${sql.and(conditions)} ORDER BY due_at LIMIT ${limit}`
				}).pipe(Effect.orDie),
			complete_task: ({ id }) =>
				Effect.gen(function* () {
					const rows =
						yield* sql`UPDATE tasks SET completed_at = now() WHERE id = ${id} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
