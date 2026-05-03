import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { EmailBlocks } from '@batuda/email/schema'

import {
	BadRequest,
	EmailSuppressed,
	GrantAuthFailed,
	GrantConnectFailed,
	GrantUnavailable,
	InboxInactive,
	NoDefaultInbox,
	NotFound,
} from '../errors'
import { OrgMiddleware } from '../middleware/org'
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

// Inbox-lifecycle errors share a common 409 envelope on send/reply paths so
// the client gets a consistent shape when an inbox can't actually transmit.
const InboxOpFailures = [
	NoDefaultInbox.pipe(HttpApiSchema.status(409)),
	InboxInactive.pipe(HttpApiSchema.status(409)),
	GrantAuthFailed.pipe(HttpApiSchema.status(409)),
	GrantConnectFailed.pipe(HttpApiSchema.status(409)),
	GrantUnavailable.pipe(HttpApiSchema.status(409)),
] as const

export const EmailGroup = HttpApiGroup.make('email')
	.add(
		HttpApiEndpoint.post('send', '/email/send', {
			payload: Schema.Struct({
				// Optional — server falls back to the calling member's primary
				// human inbox when omitted (NoDefaultInbox if none is set).
				inboxId: Schema.optional(Schema.String),
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
				...InboxOpFailures,
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
				NotFound.pipe(HttpApiSchema.status(404)),
				...InboxOpFailures,
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
			error: NotFound.pipe(HttpApiSchema.status(404)),
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
			error: NotFound.pipe(HttpApiSchema.status(404)),
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
			error: NotFound.pipe(HttpApiSchema.status(404)),
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
		// Static preset list for the connect-mailbox UI. Returns provider-
		// neutral entries (Infomaniak, Fastmail, Gmail Workspace, Microsoft
		// 365, Proton Bridge, Generic) so the UI can pre-fill the IMAP/SMTP
		// host/port/security fields.
		HttpApiEndpoint.get('listProviderPresets', '/email/providers/presets', {
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		// Probe-then-insert. The transport is generic IMAP+SMTP — caller
		// supplies host/port/security/username/password. Server runs an
		// LOGIN/EHLO probe; on auth/connect failure it still inserts the
		// row (with grant_status set) so the user can fix it from settings.
		HttpApiEndpoint.post('createInbox', '/email/inboxes', {
			payload: Schema.Struct({
				email: Schema.String,
				displayName: Schema.optional(Schema.String),
				purpose: InboxPurpose,
				ownerUserId: Schema.optional(Schema.String),
				isPrivate: Schema.optional(Schema.Boolean),
				isDefault: Schema.optional(Schema.Boolean),
				imapHost: Schema.String,
				imapPort: Schema.Number,
				imapSecurity: Schema.Literals(['tls', 'starttls', 'plain']),
				smtpHost: Schema.String,
				smtpPort: Schema.Number,
				smtpSecurity: Schema.Literals(['tls', 'starttls', 'plain']),
				username: Schema.String,
				password: Schema.String,
			}),
			success: Schema.Unknown,
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}),
	)
	.add(
		HttpApiEndpoint.patch('updateInbox', '/email/inboxes/:id', {
			params: { id: Schema.String },
			payload: Schema.Struct({
				displayName: Schema.optional(Schema.NullOr(Schema.String)),
				purpose: Schema.optional(InboxPurpose),
				ownerUserId: Schema.optional(Schema.NullOr(Schema.String)),
				isPrivate: Schema.optional(Schema.Boolean),
				isDefault: Schema.optional(Schema.Boolean),
				active: Schema.optional(Schema.Boolean),
				// Credential / transport patch: any subset triggers a re-probe.
				imapHost: Schema.optional(Schema.String),
				imapPort: Schema.optional(Schema.Number),
				imapSecurity: Schema.optional(
					Schema.Literals(['tls', 'starttls', 'plain']),
				),
				smtpHost: Schema.optional(Schema.String),
				smtpPort: Schema.optional(Schema.Number),
				smtpSecurity: Schema.optional(
					Schema.Literals(['tls', 'starttls', 'plain']),
				),
				username: Schema.optional(Schema.String),
				password: Schema.optional(Schema.String),
			}),
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.delete('deleteInbox', '/email/inboxes/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		// Re-probe credentials. Updates grant_status / grant_last_error /
		// grant_last_seen_at and returns the refreshed row.
		HttpApiEndpoint.post('testInbox', '/email/inboxes/:id/test', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		// Set the calling member's primary_inbox_id. Validates ownership
		// (same org + same user) so the call cannot point at someone else's
		// inbox.
		HttpApiEndpoint.post('setPrimaryInbox', '/email/inboxes/:id/primary', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			]),
		}),
	)
	.add(
		// Cheap "do I have a primary?" probe used to drive the settings
		// banner without paying for the full inbox list.
		HttpApiEndpoint.get('inboxStatus', '/email/inbox-status', {
			success: Schema.Struct({
				hasDefault: Schema.Boolean,
				primary: Schema.NullOr(
					Schema.Struct({
						inboxId: Schema.String,
						email: Schema.String,
					}),
				),
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
	.middleware(OrgMiddleware)
	.prefix('/v1')
