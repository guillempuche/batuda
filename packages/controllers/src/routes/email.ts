import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { BadRequest, EmailSuppressed, NotFound } from '../errors'
import { SessionMiddleware } from '../middleware/session'

const Recipients = Schema.Union([Schema.String, Schema.Array(Schema.String)])

const ThreadStatus = Schema.Literals(['open', 'closed', 'archived'])
const InboxPurpose = Schema.Literals(['human', 'agent', 'shared'])

// Outbound attachment reference — the browser uploads bytes via the
// staging endpoint first, then sends the thread with an array of
// stagingIds. Keeps the send payload JSON-clean and sidesteps multipart
// from the send path. Provider-agnostic: the server materializes the
// base64 bytes and hands them to whichever provider is active.
const SendAttachmentRef = Schema.Struct({
	stagingId: Schema.String,
})

export const EmailGroup = HttpApiGroup.make('email')
	.add(
		HttpApiEndpoint.post('send', '/email/send', {
			payload: Schema.Struct({
				inboxId: Schema.String,
				to: Recipients,
				cc: Schema.optional(Schema.Array(Schema.String)),
				bcc: Schema.optional(Schema.Array(Schema.String)),
				replyTo: Schema.optional(Schema.String),
				subject: Schema.String,
				text: Schema.optional(Schema.String),
				html: Schema.optional(Schema.String),
				companyId: Schema.String,
				contactId: Schema.optional(Schema.String),
				attachments: Schema.optional(Schema.Array(SendAttachmentRef)),
			}),
			success: Schema.Struct({
				messageId: Schema.String,
				threadId: Schema.String,
			}),
			error: Schema.Union([
				EmailSuppressed.pipe(HttpApiSchema.status(409)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.post('reply', '/email/reply', {
			payload: Schema.Struct({
				threadId: Schema.String,
				text: Schema.optional(Schema.String),
				html: Schema.optional(Schema.String),
				cc: Schema.optional(Schema.Array(Schema.String)),
				bcc: Schema.optional(Schema.Array(Schema.String)),
				attachments: Schema.optional(Schema.Array(SendAttachmentRef)),
			}),
			success: Schema.Struct({
				messageId: Schema.String,
				threadId: Schema.String,
			}),
			error: Schema.Union([
				EmailSuppressed.pipe(HttpApiSchema.status(409)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.get('listThreads', '/email/threads', {
			query: {
				inboxId: Schema.optional(Schema.String),
				companyId: Schema.optional(Schema.String),
				status: Schema.optional(ThreadStatus),
				purpose: Schema.optional(InboxPurpose),
				query: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Struct({
				items: Schema.Array(Schema.Unknown),
				total: Schema.Number,
				limit: Schema.Number,
				offset: Schema.Number,
			}),
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateThreadStatus', '/email/threads/:threadId', {
			params: { threadId: Schema.String },
			payload: Schema.Struct({ status: ThreadStatus }),
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post('markThreadRead', '/email/threads/:threadId/read', {
			params: { threadId: Schema.String },
			success: Schema.Void,
		}),
	)
	.add(
		HttpApiEndpoint.delete(
			'markThreadUnread',
			'/email/threads/:threadId/read',
			{
				params: { threadId: Schema.String },
				success: Schema.Void,
			},
		),
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
			query: {
				purpose: Schema.optional(InboxPurpose),
				active: Schema.optional(Schema.Literals(['true', 'false'])),
				ownerUserId: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('createInbox', '/email/inboxes', {
			payload: Schema.Struct({
				username: Schema.optional(Schema.String),
				domain: Schema.optional(Schema.String),
				displayName: Schema.optional(Schema.String),
				purpose: InboxPurpose,
				ownerUserId: Schema.optional(Schema.String),
				isDefault: Schema.optional(Schema.Boolean),
			}),
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateInbox', '/email/inboxes/:id', {
			params: { id: Schema.String },
			payload: Schema.Struct({
				displayName: Schema.optional(Schema.NullOr(Schema.String)),
				purpose: Schema.optional(InboxPurpose),
				ownerUserId: Schema.optional(Schema.NullOr(Schema.String)),
				isDefault: Schema.optional(Schema.Boolean),
				active: Schema.optional(Schema.Boolean),
			}),
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post('syncInboxes', '/email/inboxes/sync', {
			success: Schema.Struct({
				added: Schema.Number,
				retired: Schema.Number,
				total: Schema.Number,
			}),
		}),
	)
	.add(
		// Multipart upload — the body is parsed by the raw handler, so the
		// declared payload is Unknown. Expected parts: one File part keyed
		// `file` (the attachment bytes + filename + contentType).
		HttpApiEndpoint.post('stageAttachment', '/email/attachments/staging', {
			payload: Schema.Unknown,
			success: Schema.Struct({
				stagingId: Schema.String,
				filename: Schema.String,
				contentType: Schema.String,
				size: Schema.Number,
			}),
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}),
	)
	.add(
		// Raw passthrough — the handler pipes the provider's attachment
		// bytes straight into the HTTP response, so the declared success
		// shape is Unknown (the real content-type is set at write time).
		HttpApiEndpoint.get(
			'downloadAttachment',
			'/email/messages/:messageId/attachments/:attachmentId/download',
			{
				params: {
					messageId: Schema.String,
					attachmentId: Schema.String,
				},
				success: Schema.Unknown,
				error: NotFound.pipe(HttpApiSchema.status(404)),
			},
		),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
