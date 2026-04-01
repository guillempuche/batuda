import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const TaskId = Schema.String.pipe(Schema.brand('TaskId'))

export class Task extends Model.Class<Task>('Task')({
	id: Model.Generated(TaskId),
	companyId: Schema.String,
	contactId: Schema.NullOr(Schema.String),

	type: Schema.String,
	// values: call | visit | email | proposal | followup | other
	title: Schema.String,
	notes: Schema.NullOr(Schema.String),

	dueAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	completedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	metadata: Schema.NullOr(Schema.Unknown),
	createdAt: Model.DateTimeInsertFromDate,
}) {}
