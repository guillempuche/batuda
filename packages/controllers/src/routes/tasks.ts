import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import {
	Task,
	TaskEvent,
	TaskPriority,
	TaskSource,
	TaskStatus,
} from '@batuda/domain'

import { BadRequest, Conflict, NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'

// bulkComplete reports how many of the requested ids it actually closed.
export const BulkCompleteResult = Schema.Struct({
	completed: Schema.Number,
	ids: Schema.Array(Schema.String),
})

// The shelves the task inbox sorts work onto — a task belongs to exactly one.
export const TaskShelf = Schema.Literals([
	'overdue',
	'today',
	'thisWeek',
	'later',
	'noDue',
	'snoozed',
	'doneRecent',
])

// How many tasks sit in each shelf of the inbox. Counted over the whole
// organization, so a shelf shows its real size even when the screen only
// holds its first page.
export const TaskCounts = Schema.Struct({
	overdue: Schema.Number,
	today: Schema.Number,
	thisWeek: Schema.Number,
	later: Schema.Number,
	noDue: Schema.Number,
	snoozed: Schema.Number,
	doneRecent: Schema.Number,
})

// ── Input schemas ──

export const CreateTaskInput = Schema.Struct({
	companyId: Schema.optional(Schema.String),
	contactId: Schema.optional(Schema.String),
	type: Schema.String,
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	status: Schema.optional(TaskStatus),
	priority: Schema.optional(TaskPriority),
	source: Schema.optional(TaskSource),
	assigneeId: Schema.optional(Schema.String),
	dueAt: Schema.optional(Schema.DateTimeUtc),
	linkedInteractionId: Schema.optional(Schema.String),
	linkedCalendarEventId: Schema.optional(Schema.String),
	linkedThreadLinkId: Schema.optional(Schema.String),
	linkedProposalId: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

// PATCH /tasks/:id — every field optional; backend diffs against the
// current row and records the change in `task_events`.
export const UpdateTaskInput = Schema.Struct({
	title: Schema.optional(Schema.String),
	status: Schema.optional(TaskStatus),
	priority: Schema.optional(TaskPriority),
	assigneeId: Schema.optional(Schema.NullOr(Schema.String)),
	dueAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
	snoozedUntil: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
	companyId: Schema.optional(Schema.NullOr(Schema.String)),
	contactId: Schema.optional(Schema.NullOr(Schema.String)),
	metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
})

export const SnoozeInput = Schema.Struct({
	until: Schema.DateTimeUtc,
})

export const RescheduleInput = Schema.Struct({
	dueAt: Schema.NullOr(Schema.DateTimeUtc),
})

export const BulkCompleteInput = Schema.Struct({
	ids: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
})

// Optimistic-concurrency header for PATCH /tasks/:id — the value is the
// current row's `updated_at` ISO string (sent as `If-Match`). Stale
// writes return 409 `stale_write` so the UI can resolve the conflict.
const IfMatchHeader = Schema.Struct({
	'if-match': Schema.optional(Schema.String),
})

// ── Route group ──

export const TasksGroup = HttpApiGroup.make('tasks')
	.add(
		HttpApiEndpoint.get('list', '/tasks', {
			query: {
				companyId: Schema.optional(Schema.String),
				contactId: Schema.optional(Schema.String),
				assigneeId: Schema.optional(Schema.String),
				status: Schema.optional(Schema.String),
				priority: Schema.optional(Schema.String),
				source: Schema.optional(Schema.String),
				overdueOnly: Schema.optional(Schema.String),
				includeSnoozed: Schema.optional(Schema.String),
				dueFrom: Schema.optional(Schema.String),
				dueTo: Schema.optional(Schema.String),
				search: Schema.optional(Schema.String),
				// Status alias for callers that only care whether work is finished.
				// `completed=true` → status='done'; `completed=false` → status NOT
				// IN ('done','cancelled').
				completed: Schema.optional(Schema.String),
				// One shelf of the inbox. Needs the day edges below to know where
				// "today" starts and ends for whoever is asking.
				shelf: Schema.optional(TaskShelf),
				todayStart: Schema.optional(Schema.String),
				todayEnd: Schema.optional(Schema.String),
				weekEnd: Schema.optional(Schema.String),
				// `due` leads with the soonest deadline; `recent` with the latest
				// date on the task — its due date, or when it was created; and
				// `completed` with the most recently finished.
				sort: Schema.optional(Schema.Literals(['recent', 'due', 'completed'])),
				...pageQuery,
			},
			success: PaginatedList(Task.json),
		}),
	)
	.add(
		HttpApiEndpoint.get('counts', '/tasks/counts', {
			// The caller sends the edges of its own day and week, because only it
			// knows which timezone the person reading the screen is in.
			query: {
				todayStart: Schema.String,
				todayEnd: Schema.String,
				weekEnd: Schema.String,
			},
			success: TaskCounts,
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/tasks/:id', {
			params: { id: Schema.String },
			success: Task.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/tasks', {
			payload: CreateTaskInput,
			success: Schema.NullOr(Task.json),
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/tasks/:id', {
			params: { id: Schema.String },
			payload: UpdateTaskInput,
			headers: IfMatchHeader,
			success: Task.json,
			error: [
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			],
		}),
	)
	.add(
		HttpApiEndpoint.post('complete', '/tasks/:id/complete', {
			params: { id: Schema.String },
			success: Task.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('reopen', '/tasks/:id/reopen', {
			params: { id: Schema.String },
			success: Task.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('cancel', '/tasks/:id/cancel', {
			params: { id: Schema.String },
			success: Task.json,
			error: [
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			],
		}),
	)
	.add(
		HttpApiEndpoint.post('snooze', '/tasks/:id/snooze', {
			params: { id: Schema.String },
			payload: SnoozeInput,
			success: Task.json,
			error: [
				NotFound.pipe(HttpApiSchema.status(404)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			],
		}),
	)
	.add(
		HttpApiEndpoint.post('reschedule', '/tasks/:id/reschedule', {
			params: { id: Schema.String },
			payload: RescheduleInput,
			success: Task.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('bulkComplete', '/tasks/bulk/complete', {
			payload: BulkCompleteInput,
			success: BulkCompleteResult,
		}),
	)
	.add(
		HttpApiEndpoint.get('events', '/tasks/:id/events', {
			params: { id: Schema.String },
			query: { ...pageQuery },
			success: PaginatedList(TaskEvent.json),
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
