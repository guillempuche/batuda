import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

const CreateTaskInput = Schema.Struct({
	companyId: Schema.String,
	contactId: Schema.optional(Schema.String),
	type: Schema.String,
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	notes: Schema.optional(Schema.String),
	dueAt: Schema.optional(Schema.DateTimeUtc),
})

export const TasksGroup = HttpApiGroup.make('tasks')
	.add(
		HttpApiEndpoint.get('list', '/tasks', {
			query: {
				companyId: Schema.optional(Schema.String),
				completed: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/tasks', {
			payload: CreateTaskInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('complete', '/tasks/:id/complete', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.prefix('/api')
