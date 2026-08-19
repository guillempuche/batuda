import { Config, Effect, Schema } from 'effect'
import { McpSchema, Tool, Toolkit } from 'effect/unstable/ai'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	CurrentOrg,
	EmailMessageRecord,
	EmailThreadDetail,
	EmailThreadListItem,
	SessionContext,
} from '@batuda/controllers'
import { EmailDraft, Inbox, InboxFooter } from '@batuda/domain'
import { EmailBlocks } from '@batuda/email/schema'

import { EmailService } from '../../services/email'
import {
	EmailAttachmentStaging,
	type StagingRef,
} from '../../services/email-attachment-staging'
import {
	recipientAddresses,
	replyAddressees,
} from '../../services/recipient-address'
import { ToolMessage } from '../tool-message'
import { requireApproval } from './_elicit'
import { CompanyIdParam, EmailMessageIdParam, EmailThreadIdParam } from './_ids'
import {
	ListResult,
	McpPageLimit,
	McpPageOffset,
	PageResult,
	toItems,
	toPage,
} from './_result'

// Per-request services every email tool depends on. The MCP HTTP middleware
// (apps/server/src/mcp/http.ts) provides both alongside CurrentUser, so
// declaring them here lets the toolkit's static check see them as
// satisfied requirements rather than free `R` channels.
// McpServerClient lets the agent-facing tools raise an elicitation (the soft
// send guardrails in send_email / reply_email); the MCP runtime provides it.
const REQUEST_DEPENDENCIES = [
	SessionContext,
	CurrentOrg,
	McpSchema.McpServerClient,
]

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
//
// One rule runs through the tools below: a read answers with nothing when there
// is nothing to answer with, and an action says what it could not find. So the
// reads declare `Schema.NullOr` and the actions raise `dieNotFound`.
//
// Answering with nothing is safe here because of ../safe-toolkit.ts, whose
// `toStructuredContent` leaves structured output off entirely for a null; the
// library it stands in for would ship `structuredContent: null`, which strict
// clients reject and which makes the whole tool disappear from view. That file
// says to re-sync it on an upgrade — the reads here are part of what depends
// on it.

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
	// Soft, agent-only: a risky address or an over-cap thread asked for
	// confirmation and did not get it — either the answer was no, or this
	// client has no way to put the question. Nothing was sent, and the reason
	// says which.
	Schema.Struct({
		_tag: Schema.Literal('cancelled'),
		reason: Schema.String,
	}),
])

// The delete arm of an action-parameterized tool (manage_email_draft /
// manage_inbox_footer) returns this tagged marker so its success schema can
// stay a JSON object (never bare void) alongside the entity/send members.
const DeletedResult = Schema.Struct({ _tag: Schema.Literal('deleted') })

const ThreadStatus = Schema.Literals(['open', 'closed', 'archived'])
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
		'Send a new email. The body is a structured block tree (paragraph / heading / list / quote / divider / image) — not raw html/text. Omit inbox_id to use the calling member’s primary inbox in the active org. Attachments reference staging_ids returned by stage_email_attachment; set inline=true for cid-referenced inline images. Before composing, read the member’s standing email instructions (writing style, sign-off, do/don’t rules) from the batuda://instructions/email resource and write the body to follow them. Returns {_tag:"sent"} on success; {_tag:"suppressed"} if a recipient once hard-bounced or reported spam, which is a hard block on every path; or {_tag:"cancelled"} if an address being written to carries a deliverability verdict of "undeliverable" or "risky" and nobody confirmed it — either the answer was no, or this client cannot put a question to anybody, and the reason says which. Verdicts of "catch_all" and "unknown", and addresses nobody has checked, are not gated. Read `verification` on a contact\'s channels (list_contacts) before composing to see this coming; when a send is stopped, the reason names the exact call that lifts it. Set skip_footer=true to omit the inbox default footer.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String).annotate({
			description:
				'A mailbox of yours, from list_email_inboxes. Leave it out to send from the one you send from by default.',
		}),
		to: Recipients,
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		reply_to: Schema.optional(Schema.String),
		subject: Schema.String,
		body_json: EmailBlocks,
		preview: Schema.optional(Schema.String),
		company_id: CompanyIdParam,
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
		'Reply to the latest message in an existing email thread. Body is a structured block tree — if you want the parent quoted, emit a `quote` block wrapping sanitized parent blocks (you can read the parent via get_email_thread). Optional Cc/Bcc extend the thread. Attachments reference staging_ids from stage_email_attachment. Before composing, read the member’s standing email instructions from the batuda://instructions/email resource and write the reply to follow them. Returns {_tag:"sent"}; {_tag:"suppressed"} if a recipient once hard-bounced or reported spam; or {_tag:"cancelled"} when a confirmation was needed and not obtained — because the contact\'s address (or one added in cc/bcc) carries an "undeliverable" or "risky" verdict, or because the thread already has EMAIL_AGENT_SOFT_THREAD_LIMIT outbound messages (default 3) and this reply would be one more. The reason names which, and says when the client had no way to ask anybody — and for an address it names the call that lifts the stop. Pass acknowledge_thread_length: true to answer the message-count reason without a prompt; an address with something recorded against it is answered by vouching for it instead. Set skip_footer=true to omit the inbox default footer.',
	parameters: Schema.Struct({
		thread_id: EmailThreadIdParam,
		body_json: EmailBlocks,
		preview: Schema.optional(Schema.String),
		cc: Schema.optional(Schema.Array(Schema.String)),
		bcc: Schema.optional(Schema.Array(Schema.String)),
		attachments: Schema.optional(Schema.Array(AttachmentRef)),
		skip_footer: Schema.optional(Schema.Boolean),
		acknowledge_thread_length: Schema.optional(Schema.Boolean).annotate({
			description:
				'Set true to go ahead on a thread that already holds several outbound messages, when the person has said to keep going. It answers only that count — an address with something recorded against it still stops the send, and an address that bounced is still refused outright. Nothing is remembered: a later reply on the same thread asks again.',
		}),
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
		inbox_id: Schema.String.annotate({
			description:
				'The mailbox the upload belongs to. Staging for a draft: pass that draft’s `inboxId`, or the send will not find the file. Otherwise pass `primary.inboxId` from list_email_inboxes, the mailbox you send from by default.',
		}),
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
		'List email threads with filters. Returns an envelope {items, limit, offset, hasMore} — `hasMore` says whether more matched than were returned — read it before saying how many there are, and ask again with a larger `offset` if it is true. Each item carries message_count, last_message_at, last_message_direction, last_inbound_at, is_unread, and the linked inbox {email, displayName, description}. Supports search by subject (query) and status (open/closed/archived). Default limit is 100, max 500.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String).annotate({
			description:
				'Narrow to one mailbox, from list_email_inboxes. Leave it out to look across every mailbox you can see — unlike the tools that write a message, where leaving it out means the one you send from by default.',
		}),
		company_id: Schema.optional(Schema.String),
		status: Schema.optional(ThreadStatus),
		query: Schema.optional(Schema.String),
		limit: Schema.optional(McpPageLimit),
		offset: Schema.optional(McpPageOffset),
	}),
	success: PageResult(EmailThreadListItem),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Email Threads')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetEmailThread = Tool.make('get_email_thread', {
	description:
		'Get a full email thread with all messages from the provider. Each message is enriched with deliverability state (status, bounce_type) from email_messages. Returns null when no such thread exists in the active organization.',
	parameters: Schema.Struct({
		thread_id: EmailThreadIdParam,
	}),
	success: Schema.NullOr(EmailThreadDetail),
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
		thread_id: EmailThreadIdParam,
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
	parameters: Schema.Struct({ thread_id: EmailThreadIdParam }),
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
	parameters: Schema.Struct({ thread_id: EmailThreadIdParam }),
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
		'List per-message deliverability records (sent, delivered, bounced, complained, rejected). Filter by contact, company, or status. Use this to audit which sends failed and why. `hasMore` says whether more matched than were returned — read it before saying how many there are, and ask again with a larger `offset` if it is true.',
	parameters: Schema.Struct({
		contact_id: Schema.optional(Schema.String),
		company_id: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		limit: Schema.optional(McpPageLimit),
		offset: Schema.optional(McpPageOffset),
	}),
	success: PageResult(EmailMessageRecord),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Email Messages')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetEmailMessage = Tool.make('get_email_message', {
	description:
		'Get a single per-message deliverability record by id. Returns status, recipient, subject, error, timestamps — the full audit row for one outbound send. Returns null when no such record exists in the active organization.',
	parameters: Schema.Struct({
		message_id: EmailMessageIdParam,
	}),
	success: Schema.NullOr(EmailMessageRecord),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Email Message')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const DownloadEmailAttachment = Tool.make('download_email_attachment', {
	description:
		'Download an attachment from a received email message as base64. Returns { filename, content_type, base64, size }, or null when no such message or attachment exists. The provider stream is collected into memory — use sparingly for large files (the HTTP transport stays canonical for big transfers).',
	parameters: Schema.Struct({
		message_id: EmailMessageIdParam,
		attachment_id: Schema.String.annotate({
			description:
				'Which attachment on that message: its place in the message’s `attachments` list, counting from 0 ("0" for the first). A provider’s own attachment id is also accepted.',
		}),
	}),
	success: Schema.NullOr(
		Schema.Struct({
			filename: Schema.NullOr(Schema.String),
			content_type: Schema.String,
			base64: Schema.String,
			// Finite rather than plain Number: a byte count is never infinite, and
			// a plain number also publishes the words "Infinity" and "NaN" as a
			// second choice inside this one, which some providers refuse to read.
			size: Schema.optional(Schema.Finite),
		}),
	),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Download Email Attachment')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Inbox management ─────────────────────────────────────────────
// Each row stores its own IMAP/SMTP transport configuration plus encrypted
// credentials — Batuda is a generic mail client (Infomaniak, Fastmail, M365
// IMAP, …), not a hosted mailbox. `ownerUserId` says whose it is: set means
// it belongs to that member, null means the whole team's. That is what
// decides who may send through it and who may change it.

const ImapSecurity = Schema.Literals(['tls', 'starttls', 'plain'])
const SmtpSecurity = Schema.Literals(['tls', 'starttls', 'plain'])

const ListEmailInboxes = Tool.make('list_email_inboxes', {
	description:
		"List the mailboxes visible to the calling member in the active organization. Each row carries description (free text saying what the mailbox is for, may be empty), ownerUserId, isDefault, active flag, IMAP/SMTP transport hosts, and grant_status. ownerUserId is what matters for what you can do: it is the member the mailbox belongs to, or null when the mailbox belongs to the whole team. You can send through your own mailboxes and the team's, but not a colleague's. Filter by active flag or owner. Private mailboxes belonging to other members are hidden automatically. The response also reports whether the caller has a mailbox they send from by default (hasDefault plus its id and address), so a composer can check before send_email whether to prompt the user to connect one first.",
	parameters: Schema.Struct({
		active: Schema.optional(Schema.Boolean),
		owner_user_id: Schema.optional(Schema.String),
	}),
	success: Schema.Struct({
		items: Schema.Array(Inbox.json),
		hasDefault: Schema.Boolean,
		primary: Schema.NullOr(
			Schema.Struct({ inboxId: Schema.String, email: Schema.String }),
		),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Email Inboxes')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ListEmailProviderPresets = Tool.make('list_email_provider_presets', {
	description:
		'List the built-in mailbox presets (Infomaniak, Fastmail, iCloud Mail, Yahoo Mail, Gmail Workspace, Microsoft 365, Proton Bridge, Generic IMAP). Each entry pre-fills IMAP and SMTP host/port/security, plus appPasswordUrl (where the user generates an app-specific password for a 2FA account) and passwordAuthSupported (false for Gmail and Microsoft 365, which no longer allow password sign-in and need OAuth). manage_email_inbox callers only need to add credentials. Static — safe to cache.',
	success: ListResult(Schema.Unknown),
})
	.annotate(Tool.Title, 'List Email Provider Presets')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ManageEmailInbox = Tool.make('manage_email_inbox', {
	description:
		"Manage the mailboxes connected to the active organization. Who may do what: a member manages only their own mailboxes, while an organization admin manages anyone's — but nobody, admin included, chooses which mailbox another member sends from by default, since that is a personal preference. A mailbox you may not manage answers as if it did not exist, so do not read that as proof it is absent. action=create connects a new one and needs the full IMAP + SMTP details plus a password (use list_email_provider_presets to pre-fill hosts and ports for a known provider) — Batuda is a generic IMAP/SMTP client, not a hosted mail provider, so if the account has two-factor authentication its normal login password is rejected and a provider app-specific password is required (see appPasswordUrl on the matching preset); Gmail and Microsoft 365 no longer allow password sign-in at all (passwordAuthSupported=false). A new mailbox belongs to the caller unless shared=true sets it up for the whole team, which only an admin may do and which rules out is_private and is_default. The first mailbox someone connects becomes the one they send from, so there is usually nothing further to set. action=update changes only the fields you pass on an existing id, re-encrypting the password if one is given, and active=false hides the mailbox from composers and stops syncing while keeping historical threads. action=test re-runs a real IMAP LOGIN and SMTP check against the stored credentials and refreshes grant_status — use it after changing a password. action=delete soft-deletes: it sets active=false and is_default=false, preserving messages, and update with active=true restores it; deleting one that was already deleted reports it as absent rather than succeeding again. action=set_primary chooses which of your own mailboxes you send from when you do not say, clearing the previous one; it rejects deleted mailboxes and anyone else's. description is free text saying what the mailbox is for and nothing depends on it, up to 200 characters. Credentials are encrypted at rest.",
	parameters: Schema.Struct({
		action: Schema.Literals([
			'create',
			'update',
			'test',
			'delete',
			'set_primary',
		]),
		// Required by every action except create, which mints the row.
		id: Schema.optional(Schema.String).annotate({
			description:
				'A mailbox id from list_email_inboxes. Every action but create needs one.',
		}),
		// Required to create; on update, any of these may be passed alone.
		email: Schema.optional(Schema.String),
		password: Schema.optional(Schema.String),
		imap_host: Schema.optional(Schema.String),
		imap_port: Schema.optional(Schema.Number),
		imap_security: Schema.optional(ImapSecurity),
		smtp_host: Schema.optional(Schema.String),
		smtp_port: Schema.optional(Schema.Number),
		smtp_security: Schema.optional(SmtpSecurity),
		username: Schema.optional(Schema.String),
		display_name: Schema.optional(Schema.NullOr(Schema.String)),
		// Free text saying what the mailbox is for. Nothing depends on it.
		description: Schema.optional(Schema.NullOr(Schema.String)),
		owner_user_id: Schema.optional(Schema.NullOr(Schema.String)),
		// Set up for the whole team rather than one person, which only an
		// organization admin may do. Such a mailbox has no owner, so it can be
		// neither private nor anybody's default sender.
		shared: Schema.optional(Schema.Boolean),
		is_default: Schema.optional(Schema.Boolean),
		is_private: Schema.optional(Schema.Boolean),
		active: Schema.optional(Schema.Boolean),
	}),
	// Every action answers with the mailbox row it acted on, including delete,
	// which soft-deletes and hands back the deactivated row.
	success: Inbox.json,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Email Inbox')
	// One action deletes and two reach out to the mail servers, so the whole
	// tool carries the widest behaviour of its actions.
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, true)

// ── Draft tools ─────────────────────────────────────────────────

const ManageEmailDraft = Tool.make('manage_email_draft', {
	description:
		'Manage an email draft a human can review before sending. Omit inbox_id: a new draft is written in the calling member’s primary inbox in the active org, the same rule send_email follows, and update / send / delete act on the mailbox the draft already lives in. action=create makes a new draft (optionally linked to CRM via company_id/contact_id/mode); update changes fields on an existing draft_id; send dispatches draft_id through the same thread-link/interaction/message pipeline as a direct send, and runs the same deliverability guard on the addresses, so writing a message down first is not a way past that (it does not re-count how many outbound messages a thread already holds, which only reply_email does) (returns {_tag:"sent"}, {_tag:"suppressed"}, or {_tag:"cancelled"} — see send_email for what each means); delete permanently removes draft_id. body_json is the typed block tree preserved for lossless editor re-hydration.',
	parameters: Schema.Struct({
		action: Schema.Literals(['create', 'update', 'send', 'delete']),
		inbox_id: Schema.optional(Schema.String).annotate({
			description:
				'A mailbox of yours, from list_email_inboxes. Leave it out: a new draft is written in the mailbox you send from by default, and update, send and delete act on the mailbox the draft already lives in. Name one on send only to send from a different mailbox than the draft was written in.',
		}),
		draft_id: Schema.optional(Schema.String).annotate({
			description:
				'A draftId from list_email_drafts, or the one create answered with. Every action but create needs one.',
		}),
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
	// create / update return the draft; send returns the send result; delete
	// returns the deleted marker.
	success: Schema.Union([EmailDraft.json, SendEmailResult, DeletedResult]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Email Draft')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const ListEmailDrafts = Tool.make('list_email_drafts', {
	description:
		'List drafts for a specific inbox. Returns draft metadata (no body). If inbox_id is omitted, lists across all active inboxes. `hasMore` says whether more matched than were returned — read it before saying how many there are, and ask again with a larger `offset` if it is true.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String).annotate({
			description:
				'Narrow to one mailbox, from list_email_inboxes. Leave it out to list drafts across every mailbox you can see.',
		}),
		limit: Schema.optional(McpPageLimit),
		offset: Schema.optional(McpPageOffset),
	}),
	success: PageResult(EmailDraft.json),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Email Drafts')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetEmailDraft = Tool.make('get_email_draft', {
	description:
		'Get a single draft by id. Returns full draft contents including body_json. inbox_id is not needed: a draft is found by its own id, in whichever of your mailboxes it sits. Returns null when no draft of that id is one you can reach — a colleague’s private draft reads the same as one that was never written.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String).annotate({
			description:
				'A mailbox of yours, from list_email_inboxes. Naming one only checks it is yours; the draft is still found by its own id. Leave it out.',
		}),
		draft_id: Schema.String.annotate({
			description: 'A draftId from list_email_drafts or manage_email_draft.',
		}),
	}),
	success: Schema.NullOr(EmailDraft.json),
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
			inbox_id: Schema.String.annotate({
				description:
					'The mailbox the upload was staged into — the same inbox_id you passed to stage_email_attachment.',
			}),
			staging_id: Schema.String.annotate({
				description: 'A staging_id returned by stage_email_attachment.',
			}),
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

const ManageInboxFooter = Tool.make('manage_inbox_footer', {
	description:
		"Manage the footers appended to an inbox's outbound emails. action=list returns every footer on inbox_id; get returns one footer by footer_id (one belonging to another organization reads as not found); create adds a footer (body_json is the EmailBlocks shape used by send_email, and is_default=true makes it the one appended automatically, at most one per inbox); update changes name/body_json/is_default on footer_id, where is_default=true atomically clears the previous default; delete permanently removes footer_id.",
	parameters: Schema.Struct({
		action: Schema.Literals(['list', 'get', 'create', 'update', 'delete']),
		// Required by list; on create it says which inbox the footer belongs to.
		inbox_id: Schema.optional(Schema.String).annotate({
			description:
				'Which mailbox’s footers, from list_email_inboxes. list and create need one; get, update and delete find the footer by footer_id instead.',
		}),
		footer_id: Schema.optional(Schema.String).annotate({
			description: 'A footer id from manage_inbox_footer(action:"list").',
		}),
		name: Schema.optional(Schema.String),
		body_json: Schema.optional(EmailBlocks),
		is_default: Schema.optional(Schema.Boolean),
	}),
	// list returns the collection, get / create / update a single footer, and
	// delete the tagged marker.
	success: Schema.Union([
		ListResult(InboxFooter.json),
		InboxFooter.json,
		DeletedResult,
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Inbox Footer')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)

// Action-parameterized tools can't mark a field required per-action at the
// schema level, so the merged handlers guard the conditional ones at runtime.
// Marked, so the wording survives to the caller instead of being replaced by
// the generic sentence every unmarked fault gets (see ../tool-message).
const dieMissing = (message: string) => Effect.die(new ToolMessage(message))

// Every tool that writes a message takes the mailbox the same way — name one
// or get the one you send from by default — so every one says the same thing
// when there is no default to fall back on. Naming the call that fixes it is
// what stops a caller repeating the same request until it gives up.
const noPrimaryInbox = () =>
	dieMissing(
		'You have no mailbox you send from by default, and none was named. Call list_email_inboxes for the mailboxes you can send through and pass one as inbox_id, or connect one with manage_email_inbox(action:"create").',
	)

// The row named does not exist. Access is filtered by the database rather than
// refused, so a row belonging to another organization arrives here the same way
// — and "no such row" is the honest answer to both.
const dieNotFound = (error: { entity: string; id: string }) =>
	Effect.die(new ToolMessage(`No ${error.entity} with id ${error.id}.`))

// The read half of the same rule: nothing to answer with is answered with
// nothing. Used where a row's absence is a normal answer rather than a reason
// the caller's request could not be carried out.
const asNothing = () => Effect.succeed(null)

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
	ManageEmailInbox,
	ManageEmailDraft,
	ListEmailDrafts,
	GetEmailDraft,
	ManageInboxFooter,
)

// The verdicts that make an assistant's send stop and ask first: the two that
// say something against the address. `catch_all` means the domain answers to
// every name, so the check learned nothing about this particular mailbox, and
// `unknown` means a check ran and settled nothing — which is what having no
// verdict at all already says, and that has never been gated.
//
// A word outside the list still stops a send. The column takes free text, so
// anything unrecognised is something nobody vetted, and letting it through is
// the costly way to be wrong.
const NEVER_GATED = new Set(['deliverable', 'catch_all', 'unknown'])

export const isRiskyEmailVerdict = (verification: string | null): boolean =>
	verification !== null && !NEVER_GATED.has(verification)

/**
 * An address a message is going to that carries a verdict worth stopping for
 * and that nobody has stood behind.
 *
 * The question is put to the addresses, the way the block on bounced addresses
 * puts it, rather than to whoever they belong to. Naming a contact is optional
 * and names a person, not the mailbox — so a message to somebody's second
 * address used to be judged by the verdict on their first, and a message that
 * named nobody was never judged at all.
 *
 * A vouch settles the address rather than the row it was written on, since the
 * same mailbox commonly sits on a person and on their company, and somebody
 * standing behind it meant the address either way.
 *
 * Answers with one address when several are doubtful, since the send stops on
 * the first thing wrong with it either way. Which one is settled by address so
 * two calls about the same message say the same thing.
 */
export const riskyRecipientFor = (
	sql: SqlClient.SqlClient,
	orgId: string,
	addresses: ReadonlyArray<string>,
): Effect.Effect<
	{
		id: string
		address: string
		subjectTable: string
		subjectId: string
		verification: string | null
		owningCompanyId: string | null
	} | null,
	SqlError.SqlError
> =>
	addresses.length === 0
		? Effect.succeed(null)
		: Effect.gen(function* () {
				const rows = yield* sql<{
					id: string
					address: string
					subjectTable: string
					subjectId: string
					verification: string | null
					status: string
					owningCompanyId: string | null
				}>`
					SELECT c.id, lower(c.address) AS address, c.subject_table,
						c.subject_id, c.verification, c.status,
						-- A branch's address is managed through the company that owns
						-- it, so the answer has to name the company as well as the
						-- branch. Without this the caller is handed a branch id where a
						-- company id belongs, and the call it was told to make fails.
						s.company_id AS owning_company_id
					FROM channels c
					LEFT JOIN sites s
						ON c.subject_table = 'sites' AND s.id = c.subject_id
					WHERE c.organization_id = ${orgId}
						AND c.channel = 'email'
						AND lower(c.address) = ANY(${addresses})
						AND (c.verification IS NOT NULL OR c.status = 'valid')
					ORDER BY lower(c.address), c.verification
				`
				const vouchedFor = new Set(
					rows.filter(row => row.status === 'valid').map(row => row.address),
				)
				return (
					rows.find(
						row =>
							!vouchedFor.has(row.address) &&
							isRiskyEmailVerdict(row.verification),
					) ?? null
				)
			})

export const EmailHandlersLive = EmailTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* EmailService
		const staging = yield* EmailAttachmentStaging
		const sql = yield* SqlClient.SqlClient
		// Soft per-thread send limit for the agent path (humans are never gated).
		const softThreadLimit = yield* Config.int(
			'EMAIL_AGENT_SOFT_THREAD_LIMIT',
		).pipe(Config.withDefault(3))

		// The same question as `riskyRecipientFor`, with the organisation the
		// request resolved to filled in.
		const riskyRecipient = (addresses: ReadonlyArray<string>) =>
			Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				return yield* riskyRecipientFor(sql, currentOrg.id, addresses)
			})

		// Outbound count + where a reply lands, for the reply guard.
		const threadSendState = (threadLinkId: string, orgId: string) =>
			Effect.gen(function* () {
				const links = yield* sql<{
					externalThreadId: string
					contactId: string | null
				}>`
					SELECT external_thread_id, contact_id FROM email_thread_links
					WHERE id = ${threadLinkId} AND organization_id = ${orgId}
					LIMIT 1
				`
				const link = links[0]
				if (!link) return { count: 0, replyingTo: [] as string[] }
				const counts = yield* sql<{ n: number }>`
					SELECT count(*)::int AS n FROM email_messages
					WHERE direction = 'outbound' AND organization_id = ${orgId}
					AND (message_id = ${link.externalThreadId}
					     OR ${link.externalThreadId} = ANY("references"))
				`
				// Where a reply will actually land. This has to pick the same
				// addresses the send itself picks, or the guard judges one mailbox
				// while the message goes to another — so it repeats the send path's
				// choice: the sender of an inbound message, the addressees of an
				// outbound one, ordered the same way.
				//
				// Judging the linked person's default address instead answered about
				// a different mailbox whenever the conversation was with any other
				// one of theirs, and left a vouched address still blocked, since a
				// vouch is recorded against an address and that lookup never saw one.
				const latest = yield* sql<{
					direction: string
					recipients: { from?: string | null; to?: string[] } | null
				}>`
					SELECT direction, recipients FROM email_messages
					WHERE organization_id = ${orgId}
						AND (message_id = ${link.externalThreadId}
						     OR ${link.externalThreadId} = ANY("references"))
					ORDER BY received_at DESC NULLS LAST, status_updated_at DESC
					LIMIT 1
				`
				const newest = latest[0]
				return {
					count: counts[0]?.n ?? 0,
					replyingTo: newest ? replyAddressees(newest) : [],
				}
			})

		// Ask the agent to confirm. Nothing is sent unless the answer is yes, but
		// the three answers are kept apart: a client that cannot show a question
		// is not somebody saying no, and the caller is told which it was.
		const confirmSend = (reason: string) =>
			requireApproval(`${reason}. Send anyway?`)

		// Why nothing was sent, in the caller's words. A client with no way to ask
		// says so, rather than reporting a refusal nobody gave.
		// What was wrong, and enough to act on it. The address alone leaves a
		// caller stuck: nothing on this surface turns an address back into the
		// record holding it, so without the channel named here the one way past
		// the stop cannot be reached at all.
		const vouchCall = (risky: {
			id: string
			subjectTable: string
			subjectId: string
			owningCompanyId: string | null
		}): string => {
			if (risky.subjectTable === 'contacts')
				return `manage_contact_channels(action:"vouch", contact_id:"${risky.subjectId}", channel_id:"${risky.id}")`
			// A branch's address is reached through its company, naming the branch
			// as well; the branch id alone is not a company id and the call fails.
			if (risky.subjectTable === 'sites' && risky.owningCompanyId !== null)
				return `manage_company_channels(action:"vouch", company_id:"${risky.owningCompanyId}", site_id:"${risky.subjectId}", channel_id:"${risky.id}")`
			return `manage_company_channels(action:"vouch", company_id:"${risky.subjectId}", channel_id:"${risky.id}")`
		}

		const riskyReason = (risky: {
			id: string
			address: string
			subjectTable: string
			subjectId: string
			verification: string | null
			owningCompanyId: string | null
		}): string =>
			`${risky.address} is not confirmed deliverable (verification: ${risky.verification}). ` +
			`If you know the address is good, vouch for it: ${vouchCall(risky)}`

		const notSentReason = (
			answer: 'declined' | 'unaskable',
			reasons: string,
		): string =>
			answer === 'unaskable'
				? `this client cannot ask anyone to confirm, and ${reasons}`
				: reasons

		return {
			send_email: params =>
				Effect.gen(function* () {
					// Soft guard (agent-only): an address with something recorded
					// against it asks first.
					const risky = yield* riskyRecipient(
						recipientAddresses(params.to, params.cc, params.bcc),
					)
					if (risky) {
						const answer = yield* confirmSend(riskyReason(risky))
						if (answer !== 'confirmed') {
							return {
								_tag: 'cancelled' as const,
								reason: notSentReason(
									answer,
									`email verification for ${risky.address}: ${risky.verification}`,
								),
							}
						}
					}
					return yield* svc
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
								...(params.preview !== undefined && {
									preview: params.preview,
								}),
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
							Effect.catchTag('NoDefaultInbox', noPrimaryInbox),
						)
				}).pipe(Effect.orDie),
			reply_email: params =>
				Effect.gen(function* () {
					// Soft guards (agent-only): risky recipient and/or an
					// over-the-soft-limit thread ask for confirmation first.
					const org = yield* CurrentOrg
					const { count, replyingTo } = yield* threadSendState(
						params.thread_id,
						org.id,
					)
					const reasons: string[] = []
					// Everyone this reply reaches, judged the same way: where the
					// thread already goes, plus anybody added to this message.
					const risky = yield* riskyRecipient(
						recipientAddresses(replyingTo, params.cc, params.bcc),
					)
					if (risky) {
						reasons.push(riskyReason(risky))
					}
					// A count is not evidence about anybody, so unlike a verdict there
					// is nothing to record against an address and nothing to carry to
					// the next reply. Saying so on the call is the whole of it, and it
					// answers only this: an address with something against it still
					// stops the send.
					if (count >= softThreadLimit && !params.acknowledge_thread_length) {
						reasons.push(
							`this thread already has ${count} outbound messages (soft limit ${softThreadLimit}); pass acknowledge_thread_length: true to go ahead`,
						)
					}
					if (reasons.length > 0) {
						const answer = yield* confirmSend(`Heads up: ${reasons.join('; ')}`)
						if (answer !== 'confirmed') {
							return {
								_tag: 'cancelled' as const,
								reason: notSentReason(answer, reasons.join('; ')),
							}
						}
					}
					return yield* svc
						.reply(params.thread_id, params.body_json, {
							...(params.cc !== undefined && { cc: [...params.cc] }),
							...(params.bcc !== undefined && { bcc: [...params.bcc] }),
							...(params.preview !== undefined && {
								preview: params.preview,
							}),
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
						)
				}).pipe(Effect.orDie),
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
						...(params.query !== undefined && { query: params.query }),
						...(params.limit !== undefined && { limit: params.limit }),
						...(params.offset !== undefined && { offset: params.offset }),
					})
					.pipe(Effect.orDie, Effect.map(toPage)),
			get_email_thread: ({ thread_id }) =>
				svc
					.getThread(thread_id)
					.pipe(Effect.catchTag('NotFound', asNothing), Effect.orDie),
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
					Effect.catchTag('NotFound', dieNotFound),
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
						...(params.offset !== undefined && { offset: params.offset }),
					})
					.pipe(Effect.orDie, Effect.map(toPage)),
			get_email_message: ({ message_id }) =>
				svc
					.getMessage(message_id)
					.pipe(Effect.catchTag('NotFound', asNothing), Effect.orDie),
			download_email_attachment: ({ message_id, attachment_id }) =>
				Effect.gen(function* () {
					const piped = yield* svc
						.streamAttachment(message_id, attachment_id)
						.pipe(Effect.catchTag('NotFound', asNothing), Effect.orDie)
					if (piped === null) return null
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
				Effect.gen(function* () {
					const inboxes = yield* svc.listLocalInboxes({
						...(params.active !== undefined && { active: params.active }),
						...(params.owner_user_id !== undefined && {
							ownerUserId: params.owner_user_id,
						}),
					})
					// Carried alongside the list so a composer can tell in one call
					// whether the member still needs to connect a mailbox.
					const status = yield* svc.inboxStatus()
					return { ...toItems(inboxes), ...status }
				}),
			list_email_provider_presets: () =>
				svc.listProviderPresets().pipe(Effect.map(toItems)),
			manage_email_inbox: params => {
				// Fields the schema cannot mark required for one action alone.
				const needsId = (): Effect.Effect<string> =>
					params.id === undefined
						? dieMissing(
								`id is required to ${params.action} a mailbox — a mailbox id from list_email_inboxes.`,
							)
						: Effect.succeed(params.id)

				// Everything create and update share, passed only when supplied so
				// update leaves untouched fields alone.
				const transport = {
					...(params.is_default !== undefined && {
						isDefault: params.is_default,
					}),
					...(params.is_private !== undefined && {
						isPrivate: params.is_private,
					}),
					...(params.imap_host !== undefined && { imapHost: params.imap_host }),
					...(params.imap_port !== undefined && { imapPort: params.imap_port }),
					...(params.imap_security !== undefined && {
						imapSecurity: params.imap_security,
					}),
					...(params.smtp_host !== undefined && { smtpHost: params.smtp_host }),
					...(params.smtp_port !== undefined && { smtpPort: params.smtp_port }),
					...(params.smtp_security !== undefined && {
						smtpSecurity: params.smtp_security,
					}),
					...(params.username !== undefined && { username: params.username }),
					...(params.password !== undefined && { password: params.password }),
				}

				switch (params.action) {
					case 'create': {
						// Connecting a mailbox needs the whole transport up front —
						// there is nothing stored yet to fall back on.
						const {
							email,
							password,
							imap_host,
							imap_port,
							imap_security,
							smtp_host,
							smtp_port,
							smtp_security,
						} = params
						if (
							email === undefined ||
							password === undefined ||
							imap_host === undefined ||
							imap_port === undefined ||
							imap_security === undefined ||
							smtp_host === undefined ||
							smtp_port === undefined ||
							smtp_security === undefined
						)
							return dieMissing(
								'create needs email, password and the full imap_* and smtp_* transport details',
							)
						return (
							svc
								.createInbox({
									...transport,
									// Null means "clear it", which only makes sense against a
									// mailbox that already exists.
									...(typeof params.display_name === 'string' && {
										displayName: params.display_name,
									}),
									...(typeof params.description === 'string' && {
										description: params.description,
									}),
									...(params.shared !== undefined && { shared: params.shared }),
									...(params.is_default !== undefined && {
										isDefault: params.is_default,
									}),
									...(params.is_private !== undefined && {
										isPrivate: params.is_private,
									}),
									...(typeof params.owner_user_id === 'string' && {
										ownerUserId: params.owner_user_id,
									}),
									email,
									password,
									username: params.username ?? email,
									imapHost: imap_host,
									imapPort: imap_port,
									imapSecurity: imap_security,
									smtpHost: smtp_host,
									smtpPort: smtp_port,
									smtpSecurity: smtp_security,
								})
								// Refusals carry their reason, so the caller learns it needs
								// an admin rather than seeing an unexplained failure.
								.pipe(
									Effect.catchTag('BadRequest', e =>
										Effect.die(new ToolMessage(e.message)),
									),
									Effect.orDie,
								)
						)
					}
					case 'update':
						return needsId().pipe(
							Effect.flatMap(id =>
								svc.updateInbox(id, {
									...transport,
									// Null clears these two, which only an existing mailbox
									// can be asked to do.
									...(params.display_name !== undefined && {
										displayName: params.display_name,
									}),
									...(params.owner_user_id !== undefined && {
										ownerUserId: params.owner_user_id,
									}),
									...(params.description !== undefined && {
										description: params.description,
									}),
									...(params.is_default !== undefined && {
										isDefault: params.is_default,
									}),
									...(params.is_private !== undefined && {
										isPrivate: params.is_private,
									}),
									...(params.active !== undefined && { active: params.active }),
								}),
							),
							Effect.catchTag('NotFound', dieNotFound),
							// Refusals carry their reason, so the caller learns whose
							// mailbox it is rather than seeing an unexplained failure.
							Effect.catchTag('BadRequest', e =>
								Effect.die(new ToolMessage(e.message)),
							),
							Effect.orDie,
						)
					case 'test':
						return needsId().pipe(
							Effect.flatMap(id => svc.testInbox(id)),
							Effect.catchTag('NotFound', dieNotFound),
							Effect.orDie,
						)
					case 'delete':
						return needsId().pipe(
							Effect.flatMap(id => svc.deleteInbox(id)),
							Effect.catchTag('NotFound', dieNotFound),
							Effect.orDie,
						)
					case 'set_primary':
						return needsId().pipe(
							Effect.flatMap(id => svc.setPrimaryInbox(id)),
							// Refusals carry their reason, so the caller learns the
							// mailbox is not theirs rather than seeing a bare failure.
							Effect.catchTag('BadRequest', e =>
								Effect.die(new ToolMessage(e.message)),
							),
							Effect.orDie,
						)
				}
			},
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
							.pipe(
								Effect.catchTag('NotFound', dieNotFound),
								Effect.catchTag('NoDefaultInbox', noPrimaryInbox),
								Effect.orDie,
							)
					case 'update':
						if (params.draft_id === undefined)
							return dieMissing(
								'draft_id is required to update a draft — a draftId from list_email_drafts.',
							)
						return svc
							.updateDraft(params.inbox_id, params.draft_id, fields)
							.pipe(Effect.catchTag('NotFound', dieNotFound), Effect.orDie)
					case 'send': {
						if (params.draft_id === undefined)
							return dieMissing(
								'draft_id is required to send a draft — a draftId from list_email_drafts.',
							)
						const draftId = params.draft_id
						return Effect.gen(function* () {
							// The same guard the direct sends run. A draft dispatched from
							// here is an assistant sending, so writing the message down
							// first and posting it afterwards must not be the way past a
							// question the direct path would have asked.
							const draft = yield* svc
								.getDraft(params.inbox_id, draftId)
								.pipe(Effect.catchTag('NotFound', asNothing))
							if (draft) {
								const risky = yield* riskyRecipient(
									recipientAddresses(
										[...draft.to],
										[...draft.cc],
										[...draft.bcc],
									),
								)
								if (risky) {
									const answer = yield* confirmSend(riskyReason(risky))
									if (answer !== 'confirmed')
										return {
											_tag: 'cancelled' as const,
											reason: notSentReason(
												answer,
												`email verification for ${risky.address}: ${risky.verification}`,
											),
										}
								}
							}
							return yield* svc.sendDraft(params.inbox_id, draftId)
						}).pipe(
							Effect.map(r =>
								'_tag' in r
									? r
									: {
											_tag: 'sent' as const,
											messageId: r.messageId,
											threadId: r.threadId,
										},
							),
							Effect.catchTag('EmailSuppressed', e =>
								Effect.succeed({
									_tag: 'suppressed' as const,
									contactStatus: e.status,
									recipient: e.recipient,
									reason: e.reason,
								}),
							),
							Effect.catchTag('NotFound', dieNotFound),
							Effect.orDie,
						)
					}
					case 'delete':
						if (params.draft_id === undefined)
							return dieMissing(
								'draft_id is required to delete a draft — a draftId from list_email_drafts.',
							)
						return svc
							.deleteDraft(params.inbox_id, params.draft_id)
							.pipe(
								Effect.catchTag('NotFound', dieNotFound),
								Effect.orDie,
								Effect.as({ _tag: 'deleted' as const }),
							)
				}
			},
			list_email_drafts: params =>
				svc
					.listDrafts(params.inbox_id, params.limit, params.offset)
					.pipe(Effect.orDie, Effect.map(toPage)),
			// Both answers this can give — no such draft, and a draft in a mailbox
			// the caller may not act through — are a draft they cannot see, so both
			// read as nothing, the same way listing an unreachable mailbox does.
			get_email_draft: ({ inbox_id, draft_id }) =>
				svc
					.getDraft(inbox_id, draft_id)
					.pipe(Effect.catchTag('NotFound', asNothing), Effect.orDie),
			manage_inbox_footer: params => {
				switch (params.action) {
					case 'list':
						if (params.inbox_id === undefined)
							return dieMissing(
								'inbox_id is required to list footers — a mailbox id from list_email_inboxes.',
							)
						return svc.listFooters(params.inbox_id).pipe(Effect.map(toItems))
					case 'get':
						if (params.footer_id === undefined)
							return dieMissing(
								'footer_id is required to get a footer — a footer id from manage_inbox_footer(action:"list").',
							)
						return svc
							.getFooter(params.footer_id)
							.pipe(Effect.catchTag('NotFound', dieNotFound), Effect.orDie)
					case 'create':
						if (
							params.inbox_id === undefined ||
							params.name === undefined ||
							params.body_json === undefined
						)
							return dieMissing(
								'inbox_id, name and body_json are required to create a footer — inbox_id is a mailbox id from list_email_inboxes.',
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
							.pipe(Effect.catchTag('NotFound', dieNotFound), Effect.orDie)
					case 'update':
						if (params.footer_id === undefined)
							return dieMissing(
								'footer_id is required to update a footer — a footer id from manage_inbox_footer(action:"list").',
							)
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
							.pipe(Effect.catchTag('NotFound', dieNotFound), Effect.orDie)
					case 'delete':
						if (params.footer_id === undefined)
							return dieMissing(
								'footer_id is required to delete a footer — a footer id from manage_inbox_footer(action:"list").',
							)
						return svc
							.deleteFooter(params.footer_id)
							.pipe(Effect.as({ _tag: 'deleted' as const }))
				}
			},
		}
	}),
)
