import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { EmailBlocks } from '@engranatge/email/schema'

import { BadRequest, EmailSuppressed, NotFound } from '../errors'
import { SessionMiddleware } from '../middleware/session'

const Recipients = Schema.Union([Schema.String, Schema.Array(Schema.String)])

const ThreadStatus = Schema.Literals(['open', 'closed', 'archived'])
const InboxPurpose = Schema.Literals(['human', 'agent', 'shared'])

// Outbound attachment reference. The client uploads bytes via the
// staging endpoint first, then the send payload just names stagingIds.
// `inline` selects the Content-Disposition at MIME time; `cid` may be
// set by callers that want a stable Content-ID (agents rewriting a
// forwarded asset) — otherwise the server mints one.
const SendAttachmentRef = Schema.Struct({
	stagingId: Schema.String,
	inline: Schema.optional(Schema.Boolean),
	cid: Schema.optional(Schema.String),
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
				bodyJson: EmailBlocks,
				preview: Schema.optional(Schema.String),
				companyId: Schema.String,
				contactId: Schema.optional(Schema.String),
				attachments: Schema.optional(Schema.Array(SendAttachmentRef)),
				skipFooter: Schema.optional(Schema.Boolean),
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
				bodyJson: EmailBlocks,
				preview: Schema.optional(Schema.String),
				cc: Schema.optional(Schema.Array(Schema.String)),
				bcc: Schema.optional(Schema.Array(Schema.String)),
				attachments: Schema.optional(Schema.Array(SendAttachmentRef)),
				skipFooter: Schema.optional(Schema.Boolean),
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
		// Multipart upload — body parsed by the raw handler, so the declared
		// payload is Unknown. Expected parts: `file` (bytes + filename +
		// contentType), `inboxId`, optional `inline` flag (`"true"`/`"false"`),
		// optional `draftId` for immediate attachment.
		HttpApiEndpoint.post('stageAttachment', '/email/attachments/staging', {
			payload: Schema.Unknown,
			success: Schema.Struct({
				stagingId: Schema.String,
				filename: Schema.String,
				contentType: Schema.String,
				size: Schema.Number,
				isInline: Schema.Boolean,
				previewUrl: Schema.optional(Schema.String),
			}),
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}),
	)
	.add(
		HttpApiEndpoint.delete(
			'discardStagedAttachment',
			'/email/attachments/staging/:stagingId',
			{
				params: { stagingId: Schema.String },
				query: { inboxId: Schema.String },
				success: Schema.Void,
				error: Schema.Union([
					NotFound.pipe(HttpApiSchema.status(404)),
					BadRequest.pipe(HttpApiSchema.status(400)),
				]),
			},
		),
	)
	.add(
		// Raw passthrough — pipes the provider's attachment bytes into the
		// HTTP response, so the declared success shape is Unknown (the real
		// content-type is set at write time).
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
	// ── Drafts ──
	.add(
		HttpApiEndpoint.post('createDraft', '/email/drafts', {
			payload: Schema.Struct({
				inboxId: Schema.String,
				to: Schema.optional(Recipients),
				cc: Schema.optional(Schema.Array(Schema.String)),
				bcc: Schema.optional(Schema.Array(Schema.String)),
				subject: Schema.optional(Schema.String),
				bodyJson: Schema.optional(EmailBlocks),
				inReplyTo: Schema.optional(Schema.String),
				companyId: Schema.optional(Schema.String),
				contactId: Schema.optional(Schema.String),
				mode: Schema.optional(Schema.String),
				threadLinkId: Schema.optional(Schema.String),
			}),
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('listDrafts', '/email/drafts', {
			query: {
				inboxId: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('getDraft', '/email/drafts/:draftId', {
			params: { draftId: Schema.String },
			query: { inboxId: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateDraft', '/email/drafts/:draftId', {
			params: { draftId: Schema.String },
			payload: Schema.Struct({
				inboxId: Schema.String,
				to: Schema.optional(Recipients),
				cc: Schema.optional(Schema.Array(Schema.String)),
				bcc: Schema.optional(Schema.Array(Schema.String)),
				subject: Schema.optional(Schema.String),
				bodyJson: Schema.optional(EmailBlocks),
			}),
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.delete('deleteDraft', '/email/drafts/:draftId', {
			params: { draftId: Schema.String },
			query: { inboxId: Schema.String },
			success: Schema.Void,
		}),
	)
	.add(
		HttpApiEndpoint.post('sendDraft', '/email/drafts/:draftId/send', {
			params: { draftId: Schema.String },
			payload: Schema.Struct({
				inboxId: Schema.String,
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
	// ── Footers ──
	.add(
		HttpApiEndpoint.get('listFooters', '/email/inboxes/:inboxId/footers', {
			params: { inboxId: Schema.String },
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('createFooter', '/email/inboxes/:inboxId/footers', {
			params: { inboxId: Schema.String },
			payload: Schema.Struct({
				name: Schema.String,
				bodyJson: EmailBlocks,
				isDefault: Schema.optional(Schema.Boolean),
			}),
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.get('getFooter', '/email/footers/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateFooter', '/email/footers/:id', {
			params: { id: Schema.String },
			payload: Schema.Struct({
				name: Schema.optional(Schema.String),
				bodyJson: Schema.optional(EmailBlocks),
				isDefault: Schema.optional(Schema.Boolean),
			}),
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.delete('deleteFooter', '/email/footers/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
		}),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
