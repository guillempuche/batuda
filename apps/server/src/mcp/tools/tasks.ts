import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const CreateTask = Tool.make('create_task', {
	description: 'Create a new task for a company.',
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

const CompleteTask = Tool.make('complete_task', {
	description: 'Mark a task as completed.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
})

export const TaskTools = Toolkit.make(CreateTask, CompleteTask)

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
			complete_task: ({ id }) =>
				Effect.gen(function* () {
					const rows =
						yield* sql`UPDATE tasks SET completed_at = now() WHERE id = ${id} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
