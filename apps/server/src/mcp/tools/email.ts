import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import { EmailBlocks } from '@batuda/email/schema'

import { EmailService } from '../../services/email'
import {
	EmailAttachmentStaging,
	type StagingRef,
} from '../../services/email-attachment-staging'

// Per-request services every email tool depends on. The MCP HTTP middleware
// (apps/server/src/mcp/http.ts) provides both alongside CurrentUser, so
// declaring them here lets the toolkit's static check see them as
// satisfied requirements rather than free `R` channels.
const REQUEST_DEPENDENCIES = [SessionContext, CurrentOrg]

// Convert MCP snake_case refs to the service's camelCase StagingRef.
// `inline: false` is the default; unspecified inline means tray-style
// attachment (a PDF, zip…), not an in-body image.
const toStagingRefs = (
	list:
		| readonly {
				readonly staging_id: string
				readonly inline?: boolean | undefined
				readonly cid?: string | undefined
		  }[]
		| undefined,
): readonly StagingRef[] =>
	(list ?? []).map(r => ({
		stagingId: r.staging_id,
		inline: r.inline ?? false,
		...(r.cid !== undefined && { cid: r.cid }),
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

// MCP attachments reference staged uploads — agents call
// `stage_email_attachment` first to upload bytes, then pass the
// returned staging_id here. `inline: true` selects Content-Disposition
// inline at MIME time and lets the body reference the image via `cid`.
const AttachmentRef = Schema.Struct({
	staging_id: Schema.String,
	inline: Schema.optional(Schema.Boolean),
	cid: Schema.optional(Schema.String),
})

// ── Compose tools ────────────────────────────────────────────────

const SendEmail = Tool.make('send_email', {
	description:
		'Send a new email. The body is a structured block tree (paragraph / heading / list / quote / divider / image) — not raw html/text. Omit inbox_id to use the calling member’s primary inbox in the active org. Attachments reference staging_ids returned by stage_email_attachment; set inline=true for cid-referenced inline images. Returns {_tag:"sent"} on success or {_tag:"suppressed"} if a recipient is suppressed. Set skip_footer=true to omit the inbox default footer.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String),
		to: Recipients,
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		reply_to: Schema.optional(Schema.String),
		subject: Schema.String,
		body_json: EmailBlocks,
		preview: Schema.optional(Schema.String),
		company_id: Schema.String,
		contact_id: Schema.optional(Schema.String),
		attachments: Schema.optional(Schema.Array(AttachmentRef)),
		skip_footer: Schema.optional(Schema.Boolean),
	}),
	success: SendEmailResult,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Send Email')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const ReplyEmail = Tool.make('reply_email', {
	description:
		'Reply to the latest message in an existing email thread. Body is a structured block tree — if you want the parent quoted, emit a `quote` block wrapping sanitized parent blocks (you can read the parent via get_email_thread). Optional Cc/Bcc extend the thread. Attachments reference staging_ids from stage_email_attachment. Returns {_tag:"sent"} or {_tag:"suppressed"}. Set skip_footer=true to omit the inbox default footer.',
	parameters: Schema.Struct({
		thread_id: Schema.String,
		body_json: EmailBlocks,
		preview: Schema.optional(Schema.String),
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		attachments: Schema.optional(Schema.Array(AttachmentRef)),
		skip_footer: Schema.optional(Schema.Boolean),
	}),
	success: SendEmailResult,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Reply Email')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Attachment staging ──────────────────────────────────────────
// Bytes-in, staging_id-out. Human compose uses a multipart HTTP endpoint;
// MCP tools get this tool instead. Same backend, same object store, same
// sweep/cleanup rules — just a different transport.

const StageEmailAttachmentResult = Schema.Struct({
	staging_id: Schema.String,
	filename: Schema.String,
	content_type: Schema.String,
	size: Schema.Number,
	is_inline: Schema.Boolean,
	preview_url: Schema.optional(Schema.String),
})

const StageEmailAttachment = Tool.make('stage_email_attachment', {
	description:
		'Upload attachment bytes so they can be referenced by send_email / reply_email / footer tools. Returns a staging_id the other tools reference. Image uploads go through automatic email compression (max 1600px, JPEG/PNG normalization); other content types are stored verbatim. Set inline=true for in-body images (will be emitted as <img src="cid:..."> with Content-Disposition: inline); false (default) for tray-style attachments like PDFs. Optional draft_id ties the staging to a specific draft so cleanup runs when the draft is deleted.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		filename: Schema.String,
		content_type: Schema.String,
		content_base64: Schema.String,
		inline: Schema.optional(Schema.Boolean),
		draft_id: Schema.optional(Schema.String),
	}),
	success: StageEmailAttachmentResult,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Stage Email Attachment')
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
	dependencies: REQUEST_DEPENDENCIES,
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
	dependencies: REQUEST_DEPENDENCIES,
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
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Update Email Thread Status')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const MarkThreadRead = Tool.make('mark_email_thread_read', {
	description:
		'Mark a thread as read (stamps last_read_at = now()). Subsequent listings will show is_unread=false unless new inbound messages arrive.',
	parameters: Schema.Struct({ thread_id: Schema.String }),
	success: Schema.Void,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Mark Email Thread Read')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const MarkThreadUnread = Tool.make('mark_email_thread_unread', {
	description:
		'Mark a thread as unread (clears last_read_at). Useful when an agent wants to resurface a thread for human attention.',
	parameters: Schema.Struct({ thread_id: Schema.String }),
	success: Schema.Void,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Mark Email Thread Unread')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
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
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Email Messages')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetEmailMessage = Tool.make('get_email_message', {
	description:
		'Get a single per-message deliverability record by id. Returns status, recipient, subject, error, timestamps — the full audit row for one outbound send.',
	parameters: Schema.Struct({
		message_id: Schema.String,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Email Message')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const DownloadEmailAttachment = Tool.make('download_email_attachment', {
	description:
		'Download an attachment from a received email message as base64. Returns { filename, content_type, base64, size }. The provider stream is collected into memory — use sparingly for large files (the HTTP transport stays canonical for big transfers).',
	parameters: Schema.Struct({
		message_id: Schema.String,
		attachment_id: Schema.String,
	}),
	success: Schema.Struct({
		filename: Schema.NullOr(Schema.String),
		content_type: Schema.String,
		base64: Schema.String,
		size: Schema.optional(Schema.Number),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Download Email Attachment')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Inbox management ─────────────────────────────────────────────
// Inboxes are owned by an (organization, user) pair. Each row stores its
// own IMAP/SMTP transport configuration plus encrypted credentials —
// Batuda is a generic mail client (Infomaniak, Fastmail, M365 IMAP, …),
// not a hosted mailbox. `purpose` drives composer visibility: human
// inboxes belong to a team member, agent inboxes are AI-only, shared
// inboxes surface in both.

const ImapSecurity = Schema.Literals(['tls', 'starttls', 'plain'])
const SmtpSecurity = Schema.Literals(['tls', 'starttls', 'plain'])

const ListEmailInboxes = Tool.make('list_email_inboxes', {
	description:
		'List inbox rows visible to the calling member in the active organization. Each row carries purpose (human/agent/shared), ownerUserId, isDefault, active flag, IMAP/SMTP transport hosts, and grant_status. Filter by purpose, active flag, or owner. Private inboxes belonging to other members are hidden automatically.',
	parameters: Schema.Struct({
		purpose: Schema.optional(InboxPurpose),
		active: Schema.optional(Schema.Boolean),
		owner_user_id: Schema.optional(Schema.String),
	}),
	success: Schema.Array(Schema.Unknown),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Email Inboxes')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ListEmailProviderPresets = Tool.make('list_email_provider_presets', {
	description:
		'List the built-in mailbox presets (Infomaniak, Fastmail, iCloud Mail, Yahoo Mail, Gmail Workspace, Microsoft 365, Proton Bridge, Generic IMAP). Each entry pre-fills IMAP and SMTP host/port/security, plus appPasswordUrl (where the user generates an app-specific password for a 2FA account) and passwordAuthSupported (false for Gmail and Microsoft 365, which no longer allow password sign-in and need OAuth). create_email_inbox callers only need to add credentials. Static — safe to cache.',
	success: Schema.Array(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Email Provider Presets')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetEmailInboxStatus = Tool.make('get_email_inbox_status', {
	description:
		'Return the calling member’s primary inbox in the active organization, if any. Use before send_email/create_email_draft to confirm the user has a default inbox set; if hasDefault=false the UI should prompt them to connect a mailbox first.',
	success: Schema.Struct({
		hasDefault: Schema.Boolean,
		primary: Schema.NullOr(
			Schema.Struct({
				inboxId: Schema.String,
				email: Schema.String,
			}),
		),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Email Inbox Status')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateEmailInbox = Tool.make('create_email_inbox', {
	description:
		'Connect a new mailbox to the calling member. Requires full IMAP + SMTP transport details (use list_email_provider_presets to pre-fill these for known providers) and a password / app-password — Batuda is a generic IMAP/SMTP client, not a hosted mail provider. If the account has two-factor authentication enabled, its normal login password is rejected: the user must generate a provider app-specific password (see appPasswordUrl on the matching preset) and pass that instead. Gmail and Microsoft 365 no longer allow password sign-in at all (passwordAuthSupported=false) and will fail until an OAuth connector exists. Credentials are encrypted at rest. `purpose=human` defaults ownership to the caller; `purpose=shared` clears any owner_user_id and rejects is_private=true. Setting is_default atomically clears the previous default in the same (owner, purpose) bucket.',
	parameters: Schema.Struct({
		email: Schema.String,
		password: Schema.String,
		username: Schema.optional(Schema.String),
		display_name: Schema.optional(Schema.String),
		purpose: InboxPurpose,
		owner_user_id: Schema.optional(Schema.String),
		is_default: Schema.optional(Schema.Boolean),
		is_private: Schema.optional(Schema.Boolean),
		imap_host: Schema.String,
		imap_port: Schema.Number,
		imap_security: ImapSecurity,
		smtp_host: Schema.String,
		smtp_port: Schema.Number,
		smtp_security: SmtpSecurity,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Create Email Inbox')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const UpdateEmailInbox = Tool.make('update_email_inbox', {
	description:
		'Update fields on an existing inbox in the active organization — display name, purpose, ownership, default flag, privacy, transport configuration, or credentials. Pass only the fields to change; password (if provided) is re-encrypted with a per-row HKDF subkey. Flipping `active=false` hides the inbox from composers and stops the IMAP worker, but preserves historical thread links.',
	parameters: Schema.Struct({
		id: Schema.String,
		display_name: Schema.optional(Schema.NullOr(Schema.String)),
		purpose: Schema.optional(InboxPurpose),
		owner_user_id: Schema.optional(Schema.NullOr(Schema.String)),
		is_default: Schema.optional(Schema.Boolean),
		is_private: Schema.optional(Schema.Boolean),
		active: Schema.optional(Schema.Boolean),
		imap_host: Schema.optional(Schema.String),
		imap_port: Schema.optional(Schema.Number),
		imap_security: Schema.optional(ImapSecurity),
		smtp_host: Schema.optional(Schema.String),
		smtp_port: Schema.optional(Schema.Number),
		smtp_security: Schema.optional(SmtpSecurity),
		username: Schema.optional(Schema.String),
		password: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Update Email Inbox')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const TestEmailInbox = Tool.make('test_email_inbox', {
	description:
		'Re-probe a stored inbox: decrypts the saved credentials and runs a real IMAP LOGIN + SMTP check against the configured hosts, then updates grant_status / grant_last_error / grant_last_seen_at and returns the refreshed inbox row. Use after changing a password (for example switching to an app-specific password) to confirm the mailbox now connects.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Test Email Inbox')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, true)

const DeleteEmailInbox = Tool.make('delete_email_inbox', {
	description:
		'Soft-delete an inbox: sets active=false and is_default=false so the IMAP worker stops syncing it and composers stop offering it, while preserving historical messages and thread links. The row is not removed; use update_email_inbox with active=true to restore.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Delete Email Inbox')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const SetPrimaryEmailInbox = Tool.make('set_primary_email_inbox', {
	description:
		'Promote one of the calling member’s human inboxes to is_default=true (their primary From identity in the active organization). Clears the previous primary in the same (owner, purpose) bucket. Rejects shared inboxes, inactive inboxes, and inboxes owned by another member.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Set Primary Email Inbox')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

// ── Draft tools ─────────────────────────────────────────────────

const ManageEmailDraft = Tool.make('manage_email_draft', {
	description:
		'Manage an email draft a human can review before sending. action=create makes a new draft (optionally linked to CRM via company_id/contact_id/mode); update changes fields on an existing draft_id; send dispatches draft_id through the same thread-link/interaction/message pipeline as a direct send (returns {_tag:"sent"} or {_tag:"suppressed"}); delete permanently removes draft_id. body_json is the typed block tree preserved for lossless editor re-hydration.',
	parameters: Schema.Struct({
		action: Schema.Literals(['create', 'update', 'send', 'delete']),
		inbox_id: Schema.String,
		draft_id: Schema.optional(Schema.String),
		to: Schema.optional(Recipients),
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		subject: Schema.optional(Schema.String),
		body_json: Schema.optional(EmailBlocks),
		in_reply_to: Schema.optional(Schema.String),
		company_id: Schema.optional(Schema.String),
		contact_id: Schema.optional(Schema.String),
		mode: Schema.optional(Schema.String),
		thread_link_id: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Email Draft')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const ListEmailDrafts = Tool.make('list_email_drafts', {
	description:
		'List drafts for a specific inbox. Returns draft metadata (no body). If inbox_id is omitted, lists across all active inboxes.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String),
	}),
	success: Schema.Array(Schema.Unknown),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Email Drafts')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetEmailDraft = Tool.make('get_email_draft', {
	description:
		'Get a single draft by id within an inbox. Returns full draft contents including body_json. Returns null if no matching draft exists in the inbox (or the draft belongs to a different inbox).',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		draft_id: Schema.String,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Email Draft')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const DiscardStagedEmailAttachment = Tool.make(
	'discard_staged_email_attachment',
	{
		description:
			"Permanently discard a staged email attachment (drops the row from email_attachment_staging). staging_id must belong to the supplied inbox_id; mismatches are rejected so a tenant can't discard another tenant's staging row.",
		parameters: Schema.Struct({
			inbox_id: Schema.String,
			staging_id: Schema.String,
		}),
		success: Schema.Struct({
			status: Schema.Literal('discarded'),
		}),
		dependencies: REQUEST_DEPENDENCIES,
	},
)
	.annotate(Tool.Title, 'Discard Staged Email Attachment')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

// ── Footer tools ────────────────────────────────────────────────

const ListInboxFooters = Tool.make('list_inbox_footers', {
	description:
		'List all footers configured for an inbox. The default footer is automatically appended to outbound emails unless skipFooter is set.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
	}),
	success: Schema.Array(Schema.Unknown),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Inbox Footers')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetInboxFooter = Tool.make('get_inbox_footer', {
	description:
		'Get a single inbox footer by id. Returns name, body_json (block tree), is_default, and timestamps. Org-scope is enforced by RLS — a footer belonging to another org returns NotFound.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Inbox Footer')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ManageInboxFooter = Tool.make('manage_inbox_footer', {
	description:
		'Manage an inbox footer (the block tree appended to outbound emails). action=create adds a footer (body_json is the EmailBlocks shape used by send_email; is_default=true makes it the auto-appended default, one per inbox); update changes name/body_json/is_default on footer_id (is_default=true atomically clears the prior default); delete permanently removes footer_id.',
	parameters: Schema.Struct({
		action: Schema.Literals(['create', 'update', 'delete']),
		inbox_id: Schema.optional(Schema.String),
		footer_id: Schema.optional(Schema.String),
		name: Schema.optional(Schema.String),
		body_json: Schema.optional(EmailBlocks),
		is_default: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Inbox Footer')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)

// Action-parameterized tools can't mark a field required per-action at the
// schema level, so the merged handlers guard the conditional ones at runtime.
const dieMissing = (message: string) => Effect.die(new Error(message))

export const EmailTools = Toolkit.make(
	SendEmail,
	ReplyEmail,
	StageEmailAttachment,
	DiscardStagedEmailAttachment,
	DownloadEmailAttachment,
	ListEmailThreads,
	GetEmailThread,
	UpdateThreadStatus,
	MarkThreadRead,
	MarkThreadUnread,
	ListEmailMessages,
	GetEmailMessage,
	ListEmailInboxes,
	ListEmailProviderPresets,
	GetEmailInboxStatus,
	CreateEmailInbox,
	UpdateEmailInbox,
	TestEmailInbox,
	DeleteEmailInbox,
	SetPrimaryEmailInbox,
	ManageEmailDraft,
	ListEmailDrafts,
	GetEmailDraft,
	ListInboxFooters,
	GetInboxFooter,
	ManageInboxFooter,
)

export const EmailHandlersLive = EmailTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* EmailService
		const staging = yield* EmailAttachmentStaging
		return {
			send_email: params =>
				svc
					.send(
						params.inbox_id,
						typeof params.to === 'string' ? params.to : [...params.to],
						params.subject,
						params.body_json,
						params.company_id,
						params.contact_id,
						{
							...(params.cc !== undefined && { cc: [...params.cc] }),
							...(params.bcc !== undefined && { bcc: [...params.bcc] }),
							...(params.reply_to !== undefined && {
								replyTo: params.reply_to,
							}),
							...(params.preview !== undefined && { preview: params.preview }),
							...(params.attachments !== undefined && {
								attachmentRefs: toStagingRefs(params.attachments),
							}),
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
					),
			reply_email: params =>
				svc
					.reply(params.thread_id, params.body_json, {
						...(params.cc !== undefined && { cc: [...params.cc] }),
						...(params.bcc !== undefined && { bcc: [...params.bcc] }),
						...(params.preview !== undefined && { preview: params.preview }),
						...(params.attachments !== undefined && {
							attachmentRefs: toStagingRefs(params.attachments),
						}),
						...(params.skip_footer !== undefined && {
							skipFooter: params.skip_footer,
						}),
					})
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
			stage_email_attachment: params =>
				Effect.gen(function* () {
					const bytes = Buffer.from(params.content_base64, 'base64')
					const result = yield* staging.stage({
						inboxId: params.inbox_id,
						bytes,
						filename: params.filename,
						contentType: params.content_type,
						isInline: params.inline ?? false,
						...(params.draft_id !== undefined && { draftId: params.draft_id }),
					})
					return {
						staging_id: result.stagingId,
						filename: result.filename,
						content_type: result.contentType,
						size: result.size,
						is_inline: result.isInline,
						...(result.previewUrl !== undefined && {
							preview_url: result.previewUrl,
						}),
					}
				}).pipe(Effect.orDie),
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
			get_email_message: ({ message_id }) =>
				svc.getMessage(message_id).pipe(Effect.orDie),
			download_email_attachment: ({ message_id, attachment_id }) =>
				Effect.gen(function* () {
					const piped = yield* svc
						.streamAttachment(message_id, attachment_id)
						.pipe(Effect.orDie)
					const chunks: Uint8Array[] = []
					yield* Effect.tryPromise({
						try: async () => {
							const reader = piped.stream.getReader()
							while (true) {
								const { done, value } = await reader.read()
								if (done) break
								if (value) chunks.push(value)
							}
						},
						catch: e => new Error(`attachment stream: ${String(e)}`),
					}).pipe(Effect.orDie)
					const base64 = Buffer.concat(chunks).toString('base64')
					return {
						filename: piped.filename ?? null,
						content_type: piped.contentType,
						base64,
						...(piped.size !== undefined && { size: piped.size }),
					}
				}),
			discard_staged_email_attachment: ({ inbox_id, staging_id }) =>
				staging.discard(inbox_id, staging_id).pipe(
					Effect.map(() => ({ status: 'discarded' as const })),
					Effect.orDie,
				),
			list_email_inboxes: params =>
				svc.listLocalInboxes({
					...(params.purpose !== undefined && { purpose: params.purpose }),
					...(params.active !== undefined && { active: params.active }),
					...(params.owner_user_id !== undefined && {
						ownerUserId: params.owner_user_id,
					}),
				}),
			list_email_provider_presets: () => svc.listProviderPresets(),
			get_email_inbox_status: () => svc.inboxStatus(),
			create_email_inbox: params =>
				svc
					.createInbox({
						email: params.email,
						password: params.password,
						username: params.username ?? params.email,
						purpose: params.purpose,
						imapHost: params.imap_host,
						imapPort: params.imap_port,
						imapSecurity: params.imap_security,
						smtpHost: params.smtp_host,
						smtpPort: params.smtp_port,
						smtpSecurity: params.smtp_security,
						...(params.display_name !== undefined && {
							displayName: params.display_name,
						}),
						...(params.owner_user_id !== undefined && {
							ownerUserId: params.owner_user_id,
						}),
						...(params.is_default !== undefined && {
							isDefault: params.is_default,
						}),
						...(params.is_private !== undefined && {
							isPrivate: params.is_private,
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
						...(params.is_private !== undefined && {
							isPrivate: params.is_private,
						}),
						...(params.active !== undefined && {
							active: params.active,
						}),
						...(params.imap_host !== undefined && {
							imapHost: params.imap_host,
						}),
						...(params.imap_port !== undefined && {
							imapPort: params.imap_port,
						}),
						...(params.imap_security !== undefined && {
							imapSecurity: params.imap_security,
						}),
						...(params.smtp_host !== undefined && {
							smtpHost: params.smtp_host,
						}),
						...(params.smtp_port !== undefined && {
							smtpPort: params.smtp_port,
						}),
						...(params.smtp_security !== undefined && {
							smtpSecurity: params.smtp_security,
						}),
						...(params.username !== undefined && {
							username: params.username,
						}),
						...(params.password !== undefined && {
							password: params.password,
						}),
					})
					.pipe(
						Effect.catchTag('NotFound', e => Effect.die(e)),
						Effect.orDie,
					),
			test_email_inbox: params =>
				svc.testInbox(params.id).pipe(
					Effect.catchTag('NotFound', e => Effect.die(e)),
					Effect.orDie,
				),
			delete_email_inbox: params =>
				svc.deleteInbox(params.id).pipe(
					Effect.catchTag('NotFound', e => Effect.die(e)),
					Effect.orDie,
				),
			set_primary_email_inbox: params =>
				svc.setPrimaryInbox(params.id).pipe(Effect.orDie),
			manage_email_draft: params => {
				// Shared body fields apply to both create and update; in_reply_to and
				// the CRM-link object are create-only.
				const fields = {
					...(params.to !== undefined && {
						to: typeof params.to === 'string' ? params.to : [...params.to],
					}),
					...(params.cc !== undefined && { cc: [...params.cc] }),
					...(params.bcc !== undefined && { bcc: [...params.bcc] }),
					...(params.subject !== undefined && { subject: params.subject }),
					...(params.body_json !== undefined && {
						bodyJson: params.body_json,
					}),
				}
				switch (params.action) {
					case 'create':
						return svc
							.createDraft(
								params.inbox_id,
								{
									...fields,
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
							.pipe(Effect.orDie)
					case 'update':
						if (params.draft_id === undefined)
							return dieMissing('draft_id is required to update a draft')
						return svc
							.updateDraft(params.inbox_id, params.draft_id, fields)
							.pipe(Effect.orDie)
					case 'send':
						if (params.draft_id === undefined)
							return dieMissing('draft_id is required to send a draft')
						return svc.sendDraft(params.inbox_id, params.draft_id).pipe(
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
					case 'delete':
						if (params.draft_id === undefined)
							return dieMissing('draft_id is required to delete a draft')
						return svc
							.deleteDraft(params.inbox_id, params.draft_id)
							.pipe(Effect.orDie)
				}
			},
			list_email_drafts: params =>
				svc.listDrafts(params.inbox_id).pipe(Effect.orDie),
			get_email_draft: ({ inbox_id, draft_id }) =>
				svc.getDraft(inbox_id, draft_id).pipe(Effect.orDie),
			list_inbox_footers: params => svc.listFooters(params.inbox_id),
			get_inbox_footer: ({ id }) => svc.getFooter(id).pipe(Effect.orDie),
			manage_inbox_footer: params => {
				switch (params.action) {
					case 'create':
						if (
							params.inbox_id === undefined ||
							params.name === undefined ||
							params.body_json === undefined
						)
							return dieMissing(
								'inbox_id, name and body_json are required to create a footer',
							)
						return svc
							.createFooter({
								inboxId: params.inbox_id,
								name: params.name,
								bodyJson: params.body_json,
								...(params.is_default !== undefined && {
									isDefault: params.is_default,
								}),
							})
							.pipe(Effect.orDie)
					case 'update':
						if (params.footer_id === undefined)
							return dieMissing('footer_id is required to update a footer')
						return svc
							.updateFooter(params.footer_id, {
								...(params.name !== undefined && { name: params.name }),
								...(params.body_json !== undefined && {
									bodyJson: params.body_json,
								}),
								...(params.is_default !== undefined && {
									isDefault: params.is_default,
								}),
							})
							.pipe(
								Effect.catchTag('NotFound', e => Effect.die(e)),
								Effect.orDie,
							)
					case 'delete':
						if (params.footer_id === undefined)
							return dieMissing('footer_id is required to delete a footer')
						return svc.deleteFooter(params.footer_id)
				}
			},
		}
	}),
)
