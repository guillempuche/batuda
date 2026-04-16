import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { EmailService } from '../../services/email'

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

// ── Compose tools ────────────────────────────────────────────────

const SendEmail = Tool.make('send_email', {
	description:
		'Send a new email from a specific inbox. Accepts a single recipient or array for To/Cc/Bcc. Creates a thread link and logs an outbound interaction. Returns {_tag:"sent"} on success or {_tag:"suppressed"} if a recipient is suppressed.',
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
	}),
	success: SendEmailResult,
})
	.annotate(Tool.Title, 'Send Email')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const ReplyEmail = Tool.make('reply_email', {
	description:
		'Reply to the latest message in an existing email thread. Optional Cc/Bcc extend the thread. Returns {_tag:"sent"} on success or {_tag:"suppressed"} if the recipient is suppressed.',
	parameters: Schema.Struct({
		thread_id: Schema.String,
		text: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
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
)

export const EmailHandlersLive = EmailTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* EmailService
		return {
			send_email: params =>
				svc
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
					),
			reply_email: params =>
				svc
					.reply(
						params.thread_id,
						{
							...(params.text !== undefined && { text: params.text }),
							...(params.html !== undefined && { html: params.html }),
						},
						{
							...(params.cc !== undefined && { cc: [...params.cc] }),
							...(params.bcc !== undefined && { bcc: [...params.bcc] }),
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
					),
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
		}
	}),
)
