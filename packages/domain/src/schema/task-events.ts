import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const TaskEventId = Schema.String.pipe(Schema.brand('TaskEventId'))

export const TaskActorKind = Schema.Literals(['user', 'agent'])
export type TaskActorKind = typeof TaskActorKind.Type

export class TaskEvent extends Model.Class<TaskEvent>('TaskEvent')({
	id: Model.Generated(TaskEventId),
	taskId: Schema.String,
	at: Schema.DateTimeUtcFromDate,
	actorId: Schema.NullOr(Schema.String),
	actorKind: TaskActorKind,
	change: Schema.Unknown,
}) {}
