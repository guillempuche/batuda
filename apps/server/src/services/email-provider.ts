import { type Effect, ServiceMap } from 'effect'

import type { EmailError, EmailSendError } from '@engranatge/controllers'

// ── Provider-agnostic interfaces ──

export interface SendParams {
	readonly to: string | string[]
	readonly subject: string
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly cc?: string | string[] | undefined
	readonly bcc?: string | string[] | undefined
	readonly replyTo?: string | string[] | undefined
}

export interface ReplyParams {
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly to?: string | string[] | undefined
	readonly cc?: string | string[] | undefined
	readonly bcc?: string | string[] | undefined
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
}

export interface MagicLinkParams {
	readonly email: string
	readonly url: string
	readonly token: string
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
		readonly updateLabels: (
			inboxId: string,
			messageId: string,
			add: string[],
			remove: string[],
		) => Effect.Effect<void, EmailError>
		readonly sendMagicLink: (
			params: MagicLinkParams,
		) => Effect.Effect<void, EmailSendError>
	}
>()('EmailProvider') {}
