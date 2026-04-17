import { type Effect, ServiceMap } from 'effect'

import type { EmailError, EmailSendError } from '@engranatge/controllers'

// ── Provider-agnostic interfaces ──

// Outbound attachments — providers accept base64-encoded content. The
// service layer (staging resolver) always gives us bytes; we never pass
// URLs through so the provider contract stays one-shaped.
export interface SendAttachmentInput {
	readonly filename: string
	readonly contentType: string
	readonly contentBase64: string
	readonly contentId?: string | undefined
}

export interface SendParams {
	readonly to: string | string[]
	readonly subject: string
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly cc?: string | string[] | undefined
	readonly bcc?: string | string[] | undefined
	readonly replyTo?: string | string[] | undefined
	readonly attachments?: readonly SendAttachmentInput[] | undefined
}

export interface ReplyParams {
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly to?: string | string[] | undefined
	readonly cc?: string | string[] | undefined
	readonly bcc?: string | string[] | undefined
	readonly attachments?: readonly SendAttachmentInput[] | undefined
}

// Inbound attachment metadata — what the provider surfaces on a message
// without downloading the bytes. The bytes are fetched separately via
// `streamAttachment`.
export interface ProviderAttachmentMeta {
	readonly attachmentId: string
	readonly filename: string | undefined
	readonly size: number
	readonly contentType: string | undefined
	readonly contentId?: string | undefined
}

// Byte stream returned by `streamAttachment`. `Web ReadableStream` so it
// pipes directly into the HTTP response without provider-specific glue.
export interface ProviderAttachmentStream {
	readonly stream: ReadableStream<Uint8Array>
	readonly contentType: string
	readonly filename: string | undefined
	readonly size: number | undefined
}

export interface SendResult {
	readonly messageId: string
	readonly threadId: string
}

export interface ListParams {
	readonly limit?: number | undefined
	readonly pageToken?: string | undefined
}

export interface CreateInboxParams {
	readonly username?: string | undefined
	readonly domain?: string | undefined
	readonly displayName?: string | undefined
	readonly clientId?: string | undefined
}

export interface ProviderInbox {
	readonly inboxId: string
	readonly email: string
	readonly displayName?: string | undefined
	readonly createdAt: Date
}

export interface ProviderThreadItem {
	readonly inboxId: string
	readonly threadId: string
	readonly subject?: string | undefined
	readonly preview?: string | undefined
	readonly senders: string[]
	readonly recipients: string[]
	readonly lastMessageId: string
	readonly messageCount: number
	readonly timestamp: Date
}

export interface ProviderThread extends ProviderThreadItem {
	readonly messages: ProviderMessage[]
}

export interface ProviderMessageItem {
	readonly inboxId: string
	readonly threadId: string
	readonly messageId: string
	readonly from: string
	readonly to: string[]
	readonly cc?: string[] | undefined
	readonly subject?: string | undefined
	readonly preview?: string | undefined
	readonly timestamp: Date
}

export interface ProviderMessage extends ProviderMessageItem {
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly extractedText?: string | undefined
	readonly attachments?: readonly ProviderAttachmentMeta[] | undefined
}

export interface MagicLinkParams {
	readonly email: string
	readonly url: string
	readonly token: string
}

// ── Draft interfaces ──

export interface CreateDraftParams {
	readonly to?: string | string[] | undefined
	readonly cc?: string | string[] | undefined
	readonly bcc?: string | string[] | undefined
	readonly subject?: string | undefined
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly attachments?: readonly SendAttachmentInput[] | undefined
	readonly inReplyTo?: string | undefined
	readonly clientId?: string | undefined
}

export interface UpdateDraftParams {
	readonly to?: string | string[] | undefined
	readonly cc?: string | string[] | undefined
	readonly bcc?: string | string[] | undefined
	readonly subject?: string | undefined
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly sendAt?: Date | undefined
}

export interface ProviderDraftItem {
	readonly draftId: string
	readonly inboxId: string
	readonly clientId?: string | undefined
	readonly to?: string[] | undefined
	readonly cc?: string[] | undefined
	readonly bcc?: string[] | undefined
	readonly subject?: string | undefined
	readonly preview?: string | undefined
	readonly attachments?: readonly ProviderAttachmentMeta[] | undefined
	readonly inReplyTo?: string | undefined
	readonly sendStatus?: 'scheduled' | 'sending' | 'failed' | undefined
	readonly sendAt?: Date | undefined
	readonly updatedAt: Date
}

export interface ProviderDraft extends ProviderDraftItem {
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly createdAt: Date
}

// ── Abstract provider tag ──

export class EmailProvider extends ServiceMap.Service<
	EmailProvider,
	{
		readonly send: (
			inboxId: string,
			params: SendParams,
		) => Effect.Effect<SendResult, EmailSendError>
		readonly reply: (
			inboxId: string,
			messageId: string,
			params: ReplyParams,
		) => Effect.Effect<SendResult, EmailSendError>
		readonly listThreads: (
			inboxId: string,
			params?: ListParams,
		) => Effect.Effect<ProviderThreadItem[], EmailError>
		readonly getThread: (
			inboxId: string,
			threadId: string,
		) => Effect.Effect<ProviderThread, EmailError>
		readonly listMessages: (
			inboxId: string,
			params?: ListParams,
		) => Effect.Effect<ProviderMessageItem[], EmailError>
		readonly getMessage: (
			inboxId: string,
			messageId: string,
		) => Effect.Effect<ProviderMessage, EmailError>
		readonly listInboxes: () => Effect.Effect<ProviderInbox[], EmailError>
		readonly createInbox: (
			params: CreateInboxParams,
		) => Effect.Effect<ProviderInbox, EmailError>
		readonly streamAttachment: (
			inboxId: string,
			messageId: string,
			attachmentId: string,
		) => Effect.Effect<ProviderAttachmentStream, EmailError>
		readonly updateLabels: (
			inboxId: string,
			messageId: string,
			add: string[],
			remove: string[],
		) => Effect.Effect<void, EmailError>
		readonly sendMagicLink: (
			params: MagicLinkParams,
		) => Effect.Effect<void, EmailSendError>
		readonly createDraft: (
			inboxId: string,
			params: CreateDraftParams,
		) => Effect.Effect<ProviderDraft, EmailError>
		readonly updateDraft: (
			inboxId: string,
			draftId: string,
			params: UpdateDraftParams,
		) => Effect.Effect<ProviderDraft, EmailError>
		readonly deleteDraft: (
			inboxId: string,
			draftId: string,
		) => Effect.Effect<void, EmailError>
		readonly sendDraft: (
			inboxId: string,
			draftId: string,
		) => Effect.Effect<SendResult, EmailSendError>
		readonly listDrafts: (
			inboxId: string,
			params?: ListParams,
		) => Effect.Effect<ProviderDraftItem[], EmailError>
		readonly getDraft: (
			inboxId: string,
			draftId: string,
		) => Effect.Effect<ProviderDraft, EmailError>
	}
>()('EmailProvider') {}
