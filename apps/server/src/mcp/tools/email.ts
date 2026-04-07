import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { EmailService } from '../../services/email'

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

const SendEmail = Tool.make('send_email', {
	description:
		'Send a new email from a specific inbox. Creates a thread link and logs an outbound interaction for the company. Returns either {_tag:"sent"} on success or {_tag:"suppressed"} if the recipient is on the bounce/complaint list.',
	parameters: Schema.Struct({
		inbox_id: Schema.String,
		to: Schema.String,
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
		'Reply to the latest message in an existing email thread. Looks up the thread link to find the inbox and last message ID. Returns either {_tag:"sent"} on success or {_tag:"suppressed"} if the recipient is on the bounce/complaint list.',
	parameters: Schema.Struct({
		thread_id: Schema.String,
		text: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
	}),
	success: SendEmailResult,
})
	.annotate(Tool.Title, 'Reply Email')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

const ListEmailThreads = Tool.make('list_email_threads', {
	description:
		'List email thread links from the database. Filter by inbox or company. Returns cached metadata (subject, status), not full messages.',
	parameters: Schema.Struct({
		inbox_id: Schema.optional(Schema.String),
		company_id: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
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

export const EmailTools = Toolkit.make(
	SendEmail,
	ReplyEmail,
	ListEmailThreads,
	GetEmailThread,
	ListEmailMessages,
)

export const EmailHandlersLive = EmailTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* EmailService
		return {
			send_email: params =>
				svc
					.send(
						params.inbox_id,
						params.to,
						params.subject,
						{
							...(params.text !== undefined && { text: params.text }),
							...(params.html !== undefined && { html: params.html }),
						},
						params.company_id,
						params.contact_id,
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
					.reply(params.thread_id, {
						...(params.text !== undefined && { text: params.text }),
						...(params.html !== undefined && { html: params.html }),
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
			list_email_threads: params =>
				svc
					.listThreads({
						...(params.inbox_id !== undefined && {
							inboxId: params.inbox_id,
						}),
						...(params.company_id !== undefined && {
							companyId: params.company_id,
						}),
						...(params.limit !== undefined && { limit: params.limit }),
					})
					.pipe(Effect.orDie),
			get_email_thread: ({ thread_id }) =>
				svc.getThread(thread_id).pipe(Effect.orDie),
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
		}
	}),
)
