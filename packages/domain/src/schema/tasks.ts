import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const TaskId = Schema.String.pipe(Schema.brand('TaskId'))

export const TaskStatus = Schema.Literals([
	'open',
	'in_progress',
	'blocked',
	'in_review',
	'done',
	'cancelled',
])
export type TaskStatus = typeof TaskStatus.Type

export const TaskSource = Schema.Literals([
	'user',
	'agent',
	'webhook',
	'email',
	'booking',
])
export type TaskSource = typeof TaskSource.Type

export const TaskPriority = Schema.Literals(['low', 'normal', 'high'])
export type TaskPriority = typeof TaskPriority.Type

export class Task extends Model.Class<Task>('Task')({
	id: Model.Generated(TaskId),
	companyId: Schema.NullOr(Schema.String),
	contactId: Schema.NullOr(Schema.String),

	type: Schema.String,
	// values: call | visit | email | proposal | followup | other
	title: Schema.String,
	notes: Schema.NullOr(Schema.String),

	status: TaskStatus,
	source: TaskSource,
	priority: TaskPriority,

	assigneeId: Schema.NullOr(Schema.String),
	actorId: Schema.NullOr(Schema.String),

	dueAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	snoozedUntil: Schema.NullOr(Schema.DateTimeUtcFromDate),
	completedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	linkedInteractionId: Schema.NullOr(Schema.String),
	linkedCalendarEventId: Schema.NullOr(Schema.String),
	linkedThreadLinkId: Schema.NullOr(Schema.String),
	linkedProposalId: Schema.NullOr(Schema.String),

	metadata: Schema.NullOr(Schema.Unknown),
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
