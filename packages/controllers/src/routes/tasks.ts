import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { TaskPriority, TaskSource, TaskStatus } from '@batuda/domain'

import { BadRequest, Conflict, NotFound } from '../errors'
import { SessionMiddleware } from '../middleware/session'

// ── Input schemas ──

export const CreateTaskInput = Schema.Struct({
	companyId: Schema.optional(Schema.String),
	contactId: Schema.optional(Schema.String),
	type: Schema.String,
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	notes: Schema.optional(Schema.String),
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
	notes: Schema.optional(Schema.NullOr(Schema.String)),
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
				// Legacy alias kept until the Forja tasks inbox is rewritten in PR #4
				// (§7 of the calendar plan). `completed=true` → status='done';
				// `completed=false` → status NOT IN ('done','cancelled').
				completed: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/tasks/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/tasks', {
			payload: CreateTaskInput,
			success: Schema.Unknown,
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/tasks/:id', {
			params: { id: Schema.String },
			payload: UpdateTaskInput,
			headers: IfMatchHeader,
			success: Schema.Unknown,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.post('complete', '/tasks/:id/complete', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('reopen', '/tasks/:id/reopen', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('cancel', '/tasks/:id/cancel', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.post('snooze', '/tasks/:id/snooze', {
			params: { id: Schema.String },
			payload: SnoozeInput,
			success: Schema.Unknown,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.post('reschedule', '/tasks/:id/reschedule', {
			params: { id: Schema.String },
			payload: RescheduleInput,
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('bulkComplete', '/tasks/bulk/complete', {
			payload: BulkCompleteInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('events', '/tasks/:id/events', {
			params: { id: Schema.String },
			success: Schema.Array(Schema.Unknown),
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
