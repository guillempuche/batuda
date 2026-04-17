import { AgentMailClient } from 'agentmail'
import { Config, Effect, Layer, Redacted } from 'effect'

import {
	EmailError,
	EmailSendError,
	type EmailSendErrorKind,
} from '@engranatge/controllers'

const classifyAgentMailError = (message: string): EmailSendErrorKind => {
	const m = message.toLowerCase()
	if (
		m.includes('suppress') ||
		m.includes('blocked') ||
		m.includes('block list')
	) {
		return 'suppressed'
	}
	if (m.includes('invalid') && m.includes('recipient')) {
		return 'invalid_recipient'
	}
	if (m.includes('rate limit') || m.includes('too many')) {
		return 'rate_limited'
	}
	return 'unknown'
}

const firstRecipient = (to: string | string[]): string =>
	Array.isArray(to) ? (to[0] ?? '') : to

import {
	type CreateDraftParams,
	type CreateInboxParams,
	EmailProvider,
	type ListParams,
	type MagicLinkParams,
	type ProviderAttachmentMeta,
	type ProviderAttachmentStream,
	type ProviderDraft,
	type ProviderDraftItem,
	type ProviderInbox,
	type ProviderMessage,
	type ProviderMessageItem,
	type ProviderThread,
	type ProviderThreadItem,
	type ReplyParams,
	type SendAttachmentInput,
	type SendParams,
	type SendResult,
	type UpdateDraftParams,
} from './email-provider.js'

/** Strip keys whose value is `undefined` so exactOptionalPropertyTypes is satisfied. */
// biome-ignore lint/suspicious/noExplicitAny: runtime-only filter, outer signatures enforce types
const compact = (obj: Record<string, unknown>): any => {
	const result: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) result[k] = v
	}
	return result
}

const mapThreadItem = (t: {
	inboxId: string
	threadId: string
	subject?: string
	preview?: string
	senders: string[]
	recipients: string[]
	lastMessageId: string
	messageCount: number
	timestamp: Date
}): ProviderThreadItem => ({
	inboxId: t.inboxId,
	threadId: t.threadId,
	subject: t.subject,
	preview: t.preview,
	senders: t.senders,
	recipients: t.recipients,
	lastMessageId: t.lastMessageId,
	messageCount: t.messageCount,
	timestamp: t.timestamp,
})

const mapMessageItem = (m: {
	inboxId: string
	threadId: string
	messageId: string
	from: string
	to: string[]
	cc?: string[]
	subject?: string
	preview?: string
	timestamp: Date
}): ProviderMessageItem => ({
	inboxId: m.inboxId,
	threadId: m.threadId,
	messageId: m.messageId,
	from: m.from,
	to: m.to,
	cc: m.cc,
	subject: m.subject,
	preview: m.preview,
	timestamp: m.timestamp,
})

const mapAttachment = (a: {
	attachmentId: string
	filename?: string
	size: number
	contentType?: string
	contentId?: string
}): ProviderAttachmentMeta => ({
	attachmentId: a.attachmentId,
	filename: a.filename,
	size: a.size,
	contentType: a.contentType,
	contentId: a.contentId,
})

const mapMessage = (m: {
	inboxId: string
	threadId: string
	messageId: string
	from: string
	to: string[]
	cc?: string[]
	subject?: string
	preview?: string
	text?: string
	html?: string
	extractedText?: string
	attachments?: {
		attachmentId: string
		filename?: string
		size: number
		contentType?: string
		contentId?: string
	}[]
	timestamp: Date
}): ProviderMessage => ({
	...mapMessageItem(m),
	text: m.text,
	html: m.html,
	extractedText: m.extractedText,
	attachments: m.attachments?.map(mapAttachment),
})

// Convert our provider-agnostic SendAttachmentInput into AgentMail's
// `SendAttachment` shape (base64 string via `content`).
const toAgentMailAttachment = (a: SendAttachmentInput) => ({
	filename: a.filename,
	contentType: a.contentType,
	content: a.contentBase64,
	...(a.contentId !== undefined && { contentId: a.contentId }),
})

const mapInbox = (i: {
	inboxId: string
	email: string
	displayName?: string
	createdAt: Date
}): ProviderInbox => ({
	inboxId: i.inboxId,
	email: i.email,
	displayName: i.displayName,
	createdAt: i.createdAt,
})

const mapDraftItem = (d: {
	inboxId: string
	draftId: string
	to?: string[]
	cc?: string[]
	bcc?: string[]
	subject?: string
	preview?: string
	attachments?: {
		attachmentId: string
		filename?: string
		size: number
		contentType?: string
		contentId?: string
	}[]
	inReplyTo?: string
	sendStatus?: 'scheduled' | 'sending' | 'failed'
	sendAt?: Date
	updatedAt: Date
	clientId?: string
}): ProviderDraftItem => ({
	draftId: d.draftId,
	inboxId: d.inboxId,
	clientId: d.clientId,
	to: d.to,
	cc: d.cc,
	bcc: d.bcc,
	subject: d.subject,
	preview: d.preview,
	attachments: d.attachments?.map(mapAttachment),
	inReplyTo: d.inReplyTo,
	sendStatus: d.sendStatus,
	sendAt: d.sendAt,
	updatedAt: d.updatedAt,
})

const mapDraft = (d: {
	inboxId: string
	draftId: string
	to?: string[]
	cc?: string[]
	bcc?: string[]
	subject?: string
	preview?: string
	text?: string
	html?: string
	attachments?: {
		attachmentId: string
		filename?: string
		size: number
		contentType?: string
		contentId?: string
	}[]
	inReplyTo?: string
	sendStatus?: 'scheduled' | 'sending' | 'failed'
	sendAt?: Date
	updatedAt: Date
	createdAt: Date
	clientId?: string
}): ProviderDraft => ({
	...mapDraftItem(d),
	text: d.text,
	html: d.html,
	createdAt: d.createdAt,
})

export const AgentMailProviderLive = Layer.effect(
	EmailProvider,
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted('EMAIL_API_KEY')
		const client = new AgentMailClient({
			apiKey: Redacted.value(apiKey),
		})

		const send = (
			inboxId: string,
			params: SendParams,
		): Effect.Effect<SendResult, EmailSendError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.messages.send(
						inboxId,
						compact({
							to: params.to,
							subject: params.subject,
							text: params.text,
							html: params.html,
							cc: params.cc,
							bcc: params.bcc,
							replyTo: params.replyTo,
							attachments: params.attachments?.map(toAgentMailAttachment),
						}),
					),
				catch: e => {
					const message = e instanceof Error ? e.message : String(e)
					return new EmailSendError({
						message,
						kind: classifyAgentMailError(message),
						recipient: firstRecipient(params.to),
					})
				},
			}).pipe(
				Effect.map(r => ({ messageId: r.messageId, threadId: r.threadId })),
			)

		const reply = (
			inboxId: string,
			messageId: string,
			params: ReplyParams,
		): Effect.Effect<SendResult, EmailSendError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.messages.reply(
						inboxId,
						messageId,
						compact({
							text: params.text,
							html: params.html,
							to: params.to,
							cc: params.cc,
							bcc: params.bcc,
							attachments: params.attachments?.map(toAgentMailAttachment),
						}),
					),
				catch: e => {
					const message = e instanceof Error ? e.message : String(e)
					return new EmailSendError({
						message,
						kind: classifyAgentMailError(message),
						recipient: params.to ? firstRecipient(params.to) : null,
					})
				},
			}).pipe(
				Effect.map(r => ({ messageId: r.messageId, threadId: r.threadId })),
			)

		const listThreads = (
			inboxId: string,
			params?: ListParams,
		): Effect.Effect<ProviderThreadItem[], EmailError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.threads.list(
						inboxId,
						compact({
							limit: params?.limit,
							pageToken: params?.pageToken,
						}),
					),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(r => r.threads.map(mapThreadItem)))

		const getThread = (
			inboxId: string,
			threadId: string,
		): Effect.Effect<ProviderThread, EmailError> =>
			Effect.tryPromise({
				try: () => client.inboxes.threads.get(inboxId, threadId),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(
				Effect.map(
					(t): ProviderThread => ({
						...mapThreadItem(t),
						messages: t.messages.map(mapMessage),
					}),
				),
			)

		const listMessages = (
			inboxId: string,
			params?: ListParams,
		): Effect.Effect<ProviderMessageItem[], EmailError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.messages.list(
						inboxId,
						compact({
							limit: params?.limit,
							pageToken: params?.pageToken,
						}),
					),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(r => r.messages.map(mapMessageItem)))

		const getMessage = (
			inboxId: string,
			messageId: string,
		): Effect.Effect<ProviderMessage, EmailError> =>
			Effect.tryPromise({
				try: () => client.inboxes.messages.get(inboxId, messageId),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(mapMessage))

		const listInboxes = (): Effect.Effect<ProviderInbox[], EmailError> =>
			Effect.tryPromise({
				try: () => client.inboxes.list(),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(r => r.inboxes.map(mapInbox)))

		const createInbox = (
			params: CreateInboxParams,
		): Effect.Effect<ProviderInbox, EmailError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.create(
						compact({
							username: params.username,
							domain: params.domain,
							displayName: params.displayName,
							clientId: params.clientId,
						}),
					),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(mapInbox))

		// Fetches a signed download URL from AgentMail, then pipes the body
		// through our response. We proxy (rather than redirecting the
		// browser) so session cookies stay on the Forja origin.
		const streamAttachment = (
			inboxId: string,
			messageId: string,
			attachmentId: string,
		): Effect.Effect<ProviderAttachmentStream, EmailError> =>
			Effect.gen(function* () {
				const meta = yield* Effect.tryPromise({
					try: () =>
						client.inboxes.messages.getAttachment(
							inboxId,
							messageId,
							attachmentId,
						),
					catch: e =>
						new EmailError({
							message: e instanceof Error ? e.message : String(e),
						}),
				})
				const response = yield* Effect.tryPromise({
					try: () => fetch(meta.downloadUrl),
					catch: e =>
						new EmailError({
							message: `attachment download: ${e instanceof Error ? e.message : String(e)}`,
						}),
				})
				if (!response.ok || !response.body) {
					return yield* Effect.fail(
						new EmailError({
							message: `attachment download: HTTP ${response.status}`,
						}),
					)
				}
				return {
					stream: response.body,
					contentType: meta.contentType ?? 'application/octet-stream',
					filename: meta.filename,
					size: meta.size,
				}
			})

		const updateLabels = (
			inboxId: string,
			messageId: string,
			add: string[],
			remove: string[],
		): Effect.Effect<void, EmailError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.messages.update(inboxId, messageId, {
						addLabels: add,
						removeLabels: remove,
					}),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.asVoid)

		// Magic-link sender — uses the first configured AgentMail inbox as
		// the "from" address. AgentMail does not have a concept of a global
		// sender, so we pick deterministically from listInboxes(). If the
		// workspace has no inboxes this fails loudly at send time.
		const sendMagicLink = (
			params: MagicLinkParams,
		): Effect.Effect<void, EmailSendError> =>
			Effect.gen(function* () {
				const list = yield* Effect.tryPromise({
					try: () => client.inboxes.list(),
					catch: e =>
						new EmailSendError({
							message: `magic-link: cannot list inboxes: ${e instanceof Error ? e.message : String(e)}`,
							kind: 'unknown',
							recipient: params.email,
						}),
				})
				const sender = list.inboxes[0]
				if (!sender) {
					return yield* Effect.fail(
						new EmailSendError({
							message:
								'magic-link: no AgentMail inbox configured for outbound mail',
							kind: 'unknown',
							recipient: params.email,
						}),
					)
				}
				yield* Effect.tryPromise({
					try: () =>
						client.inboxes.messages.send(sender.inboxId, {
							to: params.email,
							subject: 'Sign in to Engranatge',
							text: `Click the link below to sign in:\n\n${params.url}\n\nThis link will expire shortly.`,
							html: `<p>Click the link below to sign in:</p><p><a href="${params.url}">${params.url}</a></p><p>This link will expire shortly.</p>`,
						}),
					catch: e => {
						const message = e instanceof Error ? e.message : String(e)
						return new EmailSendError({
							message,
							kind: classifyAgentMailError(message),
							recipient: params.email,
						})
					},
				})
			})

		const createDraft = (
			inboxId: string,
			params: CreateDraftParams,
		): Effect.Effect<ProviderDraft, EmailError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.drafts.create(
						inboxId,
						compact({
							to: params.to,
							cc: params.cc,
							bcc: params.bcc,
							subject: params.subject,
							text: params.text,
							html: params.html,
							attachments: params.attachments?.map(toAgentMailAttachment),
							inReplyTo: params.inReplyTo,
							clientId: params.clientId,
						}),
					),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(mapDraft))

		const updateDraft = (
			inboxId: string,
			draftId: string,
			params: UpdateDraftParams,
		): Effect.Effect<ProviderDraft, EmailError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.drafts.update(
						inboxId,
						draftId,
						compact({
							to: params.to,
							cc: params.cc,
							bcc: params.bcc,
							subject: params.subject,
							text: params.text,
							html: params.html,
							sendAt: params.sendAt,
						}),
					),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(mapDraft))

		const deleteDraft = (
			inboxId: string,
			draftId: string,
		): Effect.Effect<void, EmailError> =>
			Effect.tryPromise({
				try: () => client.inboxes.drafts.delete(inboxId, draftId),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.asVoid)

		const sendDraft = (
			inboxId: string,
			draftId: string,
		): Effect.Effect<SendResult, EmailSendError> =>
			Effect.tryPromise({
				try: () => client.inboxes.drafts.send(inboxId, draftId, {}),
				catch: e => {
					const message = e instanceof Error ? e.message : String(e)
					return new EmailSendError({
						message,
						kind: classifyAgentMailError(message),
						recipient: null,
					})
				},
			}).pipe(
				Effect.map(r => ({ messageId: r.messageId, threadId: r.threadId })),
			)

		const listDrafts = (
			inboxId: string,
			params?: ListParams,
		): Effect.Effect<ProviderDraftItem[], EmailError> =>
			Effect.tryPromise({
				try: () =>
					client.inboxes.drafts.list(
						inboxId,
						compact({
							limit: params?.limit,
							pageToken: params?.pageToken,
						}),
					),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(r => r.drafts.map(mapDraftItem)))

		const getDraft = (
			inboxId: string,
			draftId: string,
		): Effect.Effect<ProviderDraft, EmailError> =>
			Effect.tryPromise({
				try: () => client.inboxes.drafts.get(inboxId, draftId),
				catch: e =>
					new EmailError({
						message: e instanceof Error ? e.message : String(e),
					}),
			}).pipe(Effect.map(mapDraft))

		return {
			send,
			reply,
			listThreads,
			getThread,
			listMessages,
			getMessage,
			listInboxes,
			createInbox,
			streamAttachment,
			updateLabels,
			sendMagicLink,
			createDraft,
			updateDraft,
			deleteDraft,
			sendDraft,
			listDrafts,
			getDraft,
		} as const
	}),
)
