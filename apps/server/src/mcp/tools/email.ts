import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { EmailService } from '../../services/email'
import type { SendAttachmentInput } from '../../services/email-provider'

const mapAttachments = (
	list:
		| readonly {
				readonly filename: string
				readonly content_type: string
				readonly content_base64: string
				readonly content_id?: string | undefined
		  }[]
		| undefined,
): readonly SendAttachmentInput[] =>
	(list ?? []).map(a => ({
		filename: a.filename,
		contentType: a.content_type,
		contentBase64: a.content_base64,
		...(a.content_id !== undefined && { contentId: a.content_id }),
	}))

// ── Shared result schemas ────────────────────────────────────────
// Keeping these narrow (discriminated unions, explicit enums) so AI
// consumers can pattern-match results without re-parsing free text.

const SendEmailResult = Schema.Union([
	Schema.Struct({
		_tag: Schema.Literal('sent'),
		messageId: Schema.String,
		threadId: Schema.String,
	}),
	Schema.Struct({
		_tag: Schema.Literal('suppressed'),
		contactStatus: Schema.Literals(['bounced', 'complained']),
		recipient: Schema.String,
		reason: Schema.NullOr(Schema.String),
	}),
])

const ThreadStatus = Schema.Literals(['open', 'closed', 'archived'])
const InboxPurpose = Schema.Literals(['human', 'agent', 'shared'])
const Recipients = Schema.Union([Schema.String, Schema.Array(Schema.String)])

// MCP attachments are inline base64 (no multipart staging hop — MCP tools
// are a direct call so the AI already has the bytes). The HTTP composer
// uses stagingIds instead; both routes hit the same provider interface.
const InlineAttachment = Schema.Struct({
	filename: Schema.String,
	content_type: Schema.String,
	content_base64: Schema.String,
	content_id: Schema.optional(Schema.String),
})

// ── Compose tools ────────────────────────────────────────────────

const SendEmail = Tool.make('send_email', {
	description:
		'Send a new email from a specific inbox. Accepts a single recipient or array for To/Cc/Bcc. Attachments are inline base64 (filename + content_type + content_base64 + optional content_id for cid-referenced inline images). Creates a thread link and logs an outbound interaction. Returns {_tag:"sent"} on success or {_tag:"suppressed"} if a recipient is suppressed. Set skip_footer=true to omit the inbox default footer.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		to: Recipients,
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		reply_to: Schema.optional(Schema.String),
		subject: Schema.String,
		text: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
		company_id: Schema.String,
		contact_id: Schema.optional(Schema.String),
		attachments: Schema.optional(Schema.Array(InlineAttachment)),
		skip_footer: Schema.optional(Schema.Boolean),
	}),
	success: SendEmailResult,
})
	.annotate(Tool.Title, 'Send Email')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const ReplyEmail = Tool.make('reply_email', {
	description:
		'Reply to the latest message in an existing email thread. Optional Cc/Bcc extend the thread. Attachments are inline base64 (filename + content_type + content_base64). Returns {_tag:"sent"} on success or {_tag:"suppressed"} if the recipient is suppressed. Set skip_footer=true to omit the inbox default footer.',
	parameters: Schema.Struct({
		thread_id: Schema.String,
		text: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		attachments: Schema.optional(Schema.Array(InlineAttachment)),
		skip_footer: Schema.optional(Schema.Boolean),
	}),
	success: SendEmailResult,
})
	.annotate(Tool.Title, 'Reply Email')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Thread listing + detail ─────────────────────────────────────

const ListEmailThreads = Tool.make('list_email_threads', {
	description:
		'List email threads with filters. Returns an envelope {items, total, limit, offset}. Each item carries message_count, last_message_at, last_message_direction, last_inbound_at, is_unread, and the linked inbox {email, displayName, purpose}. Supports search by subject (query), status (open/closed/archived), and inbox purpose (human/agent/shared). Default limit is 100.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String),
		company_id: Schema.optional(Schema.String),
		status: Schema.optional(ThreadStatus),
		purpose: Schema.optional(InboxPurpose),
		query: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
		offset: Schema.optional(Schema.Number),
	}),
	success: Schema.Struct({
		items: Schema.Array(Schema.Unknown),
		total: Schema.Number,
		limit: Schema.Number,
		offset: Schema.Number,
	}),
})
	.annotate(Tool.Title, 'List Email Threads')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetEmailThread = Tool.make('get_email_thread', {
	description:
		'Get a full email thread with all messages from the provider. Each message is enriched with deliverability state (status, bounce_type) from email_messages.',
	parameters: Schema.Struct({
		thread_id: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Get Email Thread')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Thread management ────────────────────────────────────────────

const UpdateThreadStatus = Tool.make('update_email_thread_status', {
	description:
		'Change a thread status to open, closed, or archived. Closed marks the conversation resolved (still visible); archived hides from default views but preserves the audit trail.',
	parameters: Schema.Struct({
		thread_id: Schema.String,
		status: ThreadStatus,
	}),
	success: Schema.Struct({
		id: Schema.String,
		status: ThreadStatus,
		updatedAt: Schema.String,
	}),
})
	.annotate(Tool.Title, 'Update Email Thread Status')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const MarkThreadRead = Tool.make('mark_email_thread_read', {
	description:
		'Mark a thread as read (stamps last_read_at = now()). Subsequent listings will show is_unread=false unless new inbound messages arrive.',
	parameters: Schema.Struct({ thread_id: Schema.String }),
	success: Schema.Void,
})
	.annotate(Tool.Title, 'Mark Email Thread Read')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const MarkThreadUnread = Tool.make('mark_email_thread_unread', {
	description:
		'Mark a thread as unread (clears last_read_at). Useful when an agent wants to resurface a thread for human attention.',
	parameters: Schema.Struct({ thread_id: Schema.String }),
	success: Schema.Void,
})
	.annotate(Tool.Title, 'Mark Email Thread Unread')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Message audit ────────────────────────────────────────────────

const ListEmailMessages = Tool.make('list_email_messages', {
	description:
		'List per-message deliverability records (sent, delivered, bounced, complained, rejected). Filter by contact, company, or status. Use this to audit which sends failed and why.',
	parameters: Schema.Struct({
		contact_id: Schema.optional(Schema.String),
		company_id: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'List Email Messages')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Inbox management ─────────────────────────────────────────────
// Inboxes are our local CRM metadata over the provider's inbox set
// (AgentMail, LocalInbox, future Gmail/IMAP). `purpose` drives which
// composer the inbox appears in: human inboxes belong to a team
// member, agent inboxes are AI-only, shared ones surface in both.

const ListEmailInboxes = Tool.make('list_email_inboxes', {
	description:
		'List local inbox rows (our CRM metadata — not the raw provider view). Each row carries purpose (human/agent/shared), ownerUserId, isDefault, active flag, and the stable providerInboxId. Filter by purpose, active flag, or owner.',
	parameters: Schema.Struct({
		purpose: Schema.optional(InboxPurpose),
		active: Schema.optional(Schema.Boolean),
		owner_user_id: Schema.optional(Schema.String),
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Email Inboxes')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateEmailInbox = Tool.make('create_email_inbox', {
	description:
		'Create a new inbox via the provider and mirror it locally with CRM metadata. Returns the created inbox row. `purpose` drives composer visibility: human = team member, agent = AI-only, shared = both. Setting isDefault atomically clears the previous default in the same purpose bucket.',
	parameters: Schema.Struct({
		username: Schema.optional(Schema.String),
		domain: Schema.optional(Schema.String),
		display_name: Schema.optional(Schema.String),
		purpose: InboxPurpose,
		owner_user_id: Schema.optional(Schema.String),
		is_default: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Create Email Inbox')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const UpdateEmailInbox = Tool.make('update_email_inbox', {
	description:
		'Update CRM metadata on a local inbox row (displayName, purpose, ownerUserId, isDefault, active). Does not rename the provider address. Flipping `active=false` hides the inbox from composers without deleting historical thread links.',
	parameters: Schema.Struct({
		id: Schema.String,
		display_name: Schema.optional(Schema.NullOr(Schema.String)),
		purpose: Schema.optional(InboxPurpose),
		owner_user_id: Schema.optional(Schema.NullOr(Schema.String)),
		is_default: Schema.optional(Schema.Boolean),
		active: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Update Email Inbox')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const SyncEmailInboxes = Tool.make('sync_email_inboxes', {
	description:
		'Reconcile the local inbox table with the provider. Inserts rows for provider inboxes missing locally (defaulting to purpose=shared) and marks rows whose provider id has disappeared as active=false. Returns counts of added and retired rows.',
	parameters: Schema.Struct({}),
	success: Schema.Struct({
		added: Schema.Number,
		retired: Schema.Number,
		total: Schema.Number,
	}),
})
	.annotate(Tool.Title, 'Sync Email Inboxes')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Draft tools ─────────────────────────────────────────────────

const CreateEmailDraft = Tool.make('create_email_draft', {
	description:
		'Create a draft email that a human can review in Forja before sending. The draft is stored on the provider (AgentMail) and shows up in the compose dock. Optionally set company_id/contact_id/mode to link to CRM context.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		to: Schema.optional(Recipients),
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		subject: Schema.optional(Schema.String),
		text: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
		in_reply_to: Schema.optional(Schema.String),
		company_id: Schema.optional(Schema.String),
		contact_id: Schema.optional(Schema.String),
		mode: Schema.optional(Schema.String),
		thread_link_id: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Create Email Draft')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const UpdateEmailDraft = Tool.make('update_email_draft', {
	description:
		'Update fields on an existing draft. Pass only the fields you want to change.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		draft_id: Schema.String,
		to: Schema.optional(Recipients),
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		subject: Schema.optional(Schema.String),
		text: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Update Email Draft')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const SendEmailDraft = Tool.make('send_email_draft', {
	description:
		'Send a previously created draft. This triggers the same thread-link/interaction/message recording pipeline as a direct send. Returns {_tag:"sent"} or {_tag:"suppressed"}.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		draft_id: Schema.String,
	}),
	success: SendEmailResult,
})
	.annotate(Tool.Title, 'Send Email Draft')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const ListEmailDrafts = Tool.make('list_email_drafts', {
	description:
		'List drafts for a specific inbox. Returns draft metadata (no body). If inbox_id is omitted, lists across all active inboxes.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String),
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Email Drafts')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Footer tools ────────────────────────────────────────────────

const ListInboxFooters = Tool.make('list_inbox_footers', {
	description:
		'List all footers configured for an inbox. The default footer is automatically appended to outbound emails unless skipFooter is set.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
	}),
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Inbox Footers')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateInboxFooter = Tool.make('create_inbox_footer', {
	description:
		'Create an HTML footer for an inbox. If is_default is true, this becomes the footer automatically appended to outbound emails. Only one default per inbox is allowed.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		name: Schema.String,
		html: Schema.String,
		text_fallback: Schema.optional(Schema.String),
		is_default: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Create Inbox Footer')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateInboxFooter = Tool.make('update_inbox_footer', {
	description:
		'Update an existing inbox footer. Flipping is_default=true atomically clears the previous default for the same inbox.',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
		text_fallback: Schema.optional(Schema.String),
		is_default: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Update Inbox Footer')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const DeleteInboxFooter = Tool.make('delete_inbox_footer', {
	description:
		'Permanently delete an inbox footer. If the deleted footer was the default, no footer will be appended to future outbound emails until another is set as default.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Void,
})
	.annotate(Tool.Title, 'Delete Inbox Footer')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)

export const EmailTools = Toolkit.make(
	SendEmail,
	ReplyEmail,
	ListEmailThreads,
	GetEmailThread,
	UpdateThreadStatus,
	MarkThreadRead,
	MarkThreadUnread,
	ListEmailMessages,
	ListEmailInboxes,
	CreateEmailInbox,
	UpdateEmailInbox,
	SyncEmailInboxes,
	CreateEmailDraft,
	UpdateEmailDraft,
	SendEmailDraft,
	ListEmailDrafts,
	ListInboxFooters,
	CreateInboxFooter,
	UpdateInboxFooter,
	DeleteInboxFooter,
)

export const EmailHandlersLive = EmailTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* EmailService
		return {
			send_email: params => {
				const attachments = mapAttachments(params.attachments)
				return svc
					.send(
						params.inbox_id,
						typeof params.to === 'string' ? params.to : [...params.to],
						params.subject,
						{
							...(params.text !== undefined && { text: params.text }),
							...(params.html !== undefined && { html: params.html }),
						},
						params.company_id,
						params.contact_id,
						{
							...(params.cc !== undefined && { cc: [...params.cc] }),
							...(params.bcc !== undefined && { bcc: [...params.bcc] }),
							...(params.reply_to !== undefined && {
								replyTo: params.reply_to,
							}),
							...(attachments.length > 0 && { attachments }),
							...(params.skip_footer !== undefined && {
								skipFooter: params.skip_footer,
							}),
						},
					)
					.pipe(
						Effect.map(r => ({
							_tag: 'sent' as const,
							messageId: r.messageId,
							threadId: r.threadId,
						})),
						Effect.catchTag('EmailSuppressed', e =>
							Effect.succeed({
								_tag: 'suppressed' as const,
								contactStatus: e.status,
								recipient: e.recipient,
								reason: e.reason,
							}),
						),
						Effect.orDie,
					)
			},
			reply_email: params => {
				const attachments = mapAttachments(params.attachments)
				return svc
					.reply(
						params.thread_id,
						{
							...(params.text !== undefined && { text: params.text }),
							...(params.html !== undefined && { html: params.html }),
						},
						{
							...(params.cc !== undefined && { cc: [...params.cc] }),
							...(params.bcc !== undefined && { bcc: [...params.bcc] }),
							...(attachments.length > 0 && { attachments }),
							...(params.skip_footer !== undefined && {
								skipFooter: params.skip_footer,
							}),
						},
					)
					.pipe(
						Effect.map(r => ({
							_tag: 'sent' as const,
							messageId: r.messageId,
							threadId: r.threadId,
						})),
						Effect.catchTag('EmailSuppressed', e =>
							Effect.succeed({
								_tag: 'suppressed' as const,
								contactStatus: e.status,
								recipient: e.recipient,
								reason: e.reason,
							}),
						),
						Effect.orDie,
					)
			},
			list_email_threads: params =>
				svc
					.listThreads({
						...(params.inbox_id !== undefined && {
							inboxId: params.inbox_id,
						}),
						...(params.company_id !== undefined && {
							companyId: params.company_id,
						}),
						...(params.status !== undefined && { status: params.status }),
						...(params.purpose !== undefined && {
							purpose: params.purpose,
						}),
						...(params.query !== undefined && { query: params.query }),
						...(params.limit !== undefined && { limit: params.limit }),
						...(params.offset !== undefined && { offset: params.offset }),
					})
					.pipe(Effect.orDie),
			get_email_thread: ({ thread_id }) =>
				svc.getThread(thread_id).pipe(Effect.orDie),
			update_email_thread_status: ({ thread_id, status }) =>
				svc.updateThreadStatus(thread_id, status).pipe(
					Effect.map(r => ({
						id: r['id'] as string,
						status: r['status'] as 'open' | 'closed' | 'archived',
						updatedAt:
							r['updatedAt'] instanceof Date
								? r['updatedAt'].toISOString()
								: String(r['updatedAt']),
					})),
					Effect.catchTag('NotFound', e => Effect.die(e)),
					Effect.orDie,
				),
			mark_email_thread_read: ({ thread_id }) => svc.markThreadRead(thread_id),
			mark_email_thread_unread: ({ thread_id }) =>
				svc.markThreadUnread(thread_id),
			list_email_messages: params =>
				svc
					.listMessages({
						...(params.contact_id !== undefined && {
							contactId: params.contact_id,
						}),
						...(params.company_id !== undefined && {
							companyId: params.company_id,
						}),
						...(params.status !== undefined && {
							status: params.status,
						}),
						...(params.limit !== undefined && { limit: params.limit }),
					})
					.pipe(Effect.orDie),
			list_email_inboxes: params =>
				svc.listLocalInboxes({
					...(params.purpose !== undefined && { purpose: params.purpose }),
					...(params.active !== undefined && { active: params.active }),
					...(params.owner_user_id !== undefined && {
						ownerUserId: params.owner_user_id,
					}),
				}),
			create_email_inbox: params =>
				svc
					.createInbox({
						...(params.username !== undefined && {
							username: params.username,
						}),
						...(params.domain !== undefined && {
							domain: params.domain,
						}),
						...(params.display_name !== undefined && {
							displayName: params.display_name,
						}),
						purpose: params.purpose,
						...(params.owner_user_id !== undefined && {
							ownerUserId: params.owner_user_id,
						}),
						...(params.is_default !== undefined && {
							isDefault: params.is_default,
						}),
					})
					.pipe(Effect.orDie),
			update_email_inbox: params =>
				svc
					.updateInbox(params.id, {
						...(params.display_name !== undefined && {
							displayName: params.display_name,
						}),
						...(params.purpose !== undefined && {
							purpose: params.purpose,
						}),
						...(params.owner_user_id !== undefined && {
							ownerUserId: params.owner_user_id,
						}),
						...(params.is_default !== undefined && {
							isDefault: params.is_default,
						}),
						...(params.active !== undefined && {
							active: params.active,
						}),
					})
					.pipe(
						Effect.catchTag('NotFound', e => Effect.die(e)),
						Effect.orDie,
					),
			sync_email_inboxes: () => svc.syncInboxes(),
			create_email_draft: params =>
				svc
					.createDraft(
						params.inbox_id,
						{
							...(params.to !== undefined && {
								to: typeof params.to === 'string' ? params.to : [...params.to],
							}),
							...(params.cc !== undefined && { cc: [...params.cc] }),
							...(params.bcc !== undefined && { bcc: [...params.bcc] }),
							...(params.subject !== undefined && {
								subject: params.subject,
							}),
							...(params.text !== undefined && { text: params.text }),
							...(params.html !== undefined && { html: params.html }),
							...(params.in_reply_to !== undefined && {
								inReplyTo: params.in_reply_to,
							}),
						},
						{
							...(params.company_id !== undefined && {
								companyId: params.company_id,
							}),
							...(params.contact_id !== undefined && {
								contactId: params.contact_id,
							}),
							...(params.mode !== undefined && { mode: params.mode }),
							...(params.thread_link_id !== undefined && {
								threadLinkId: params.thread_link_id,
							}),
						},
					)
					.pipe(Effect.orDie),
			update_email_draft: params =>
				svc
					.updateDraft(params.inbox_id, params.draft_id, {
						...(params.to !== undefined && {
							to: typeof params.to === 'string' ? params.to : [...params.to],
						}),
						...(params.cc !== undefined && { cc: [...params.cc] }),
						...(params.bcc !== undefined && { bcc: [...params.bcc] }),
						...(params.subject !== undefined && {
							subject: params.subject,
						}),
						...(params.text !== undefined && { text: params.text }),
						...(params.html !== undefined && { html: params.html }),
					})
					.pipe(Effect.orDie),
			send_email_draft: params =>
				svc.sendDraft(params.inbox_id, params.draft_id).pipe(
					Effect.map(r => ({
						_tag: 'sent' as const,
						messageId: r.messageId,
						threadId: r.threadId,
					})),
					Effect.catchTag('EmailSuppressed', e =>
						Effect.succeed({
							_tag: 'suppressed' as const,
							contactStatus: e.status,
							recipient: e.recipient,
							reason: e.reason,
						}),
					),
					Effect.orDie,
				),
			list_email_drafts: params =>
				svc.listDrafts(params.inbox_id).pipe(Effect.orDie),
			list_inbox_footers: params => svc.listFooters(params.inbox_id),
			create_inbox_footer: params =>
				svc
					.createFooter({
						inboxId: params.inbox_id,
						name: params.name,
						html: params.html,
						...(params.text_fallback !== undefined && {
							textFallback: params.text_fallback,
						}),
						...(params.is_default !== undefined && {
							isDefault: params.is_default,
						}),
					})
					.pipe(Effect.orDie),
			update_inbox_footer: params =>
				svc
					.updateFooter(params.id, {
						...(params.name !== undefined && { name: params.name }),
						...(params.html !== undefined && { html: params.html }),
						...(params.text_fallback !== undefined && {
							textFallback: params.text_fallback,
						}),
						...(params.is_default !== undefined && {
							isDefault: params.is_default,
						}),
					})
					.pipe(
						Effect.catchTag('NotFound', e => Effect.die(e)),
						Effect.orDie,
					),
			delete_inbox_footer: params => svc.deleteFooter(params.id),
		}
	}),
)
