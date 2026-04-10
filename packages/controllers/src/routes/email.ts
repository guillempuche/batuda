import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { EmailSuppressed } from '../errors'
import { SessionMiddleware } from '../middleware/session'

export const EmailGroup = HttpApiGroup.make('email')
	.add(
		HttpApiEndpoint.post('send', '/email/send', {
			payload: Schema.Struct({
				inboxId: Schema.String,
				to: Schema.String,
				subject: Schema.String,
				text: Schema.optional(Schema.String),
				html: Schema.optional(Schema.String),
				companyId: Schema.String,
				contactId: Schema.optional(Schema.String),
			}),
			success: Schema.Struct({
				messageId: Schema.String,
				threadId: Schema.String,
			}),
			error: EmailSuppressed.pipe(HttpApiSchema.status(409)),
		}),
	)
	.add(
		HttpApiEndpoint.post('reply', '/email/reply', {
			payload: Schema.Struct({
				threadId: Schema.String,
				text: Schema.optional(Schema.String),
				html: Schema.optional(Schema.String),
			}),
			success: Schema.Struct({
				messageId: Schema.String,
				threadId: Schema.String,
			}),
			error: EmailSuppressed.pipe(HttpApiSchema.status(409)),
		}),
	)
	.add(
		HttpApiEndpoint.get('listThreads', '/email/threads', {
			query: {
				inboxId: Schema.optional(Schema.String),
				companyId: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('getThread', '/email/threads/:threadId', {
			params: { threadId: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('listMessages', '/email/messages', {
			query: {
				contactId: Schema.optional(Schema.String),
				companyId: Schema.optional(Schema.String),
				status: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('getMessage', '/email/messages/:messageId', {
			params: { messageId: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('listInboxes', '/email/inboxes', {
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
