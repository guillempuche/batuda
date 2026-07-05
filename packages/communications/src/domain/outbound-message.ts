export interface OutboundAttachment {
	readonly filename: string
	readonly contentType: string
	readonly contentBase64: string
	readonly contentId?: string | undefined
	readonly disposition?: 'inline' | 'attachment' | undefined
}

// A message ready to hand to a channel transport. A single channel-agnostic
// shape so every channel's `send` speaks one message type.
export interface OutboundMessage {
	readonly from: string
	readonly to: readonly string[]
	readonly cc?: readonly string[] | undefined
	readonly bcc?: readonly string[] | undefined
	readonly replyTo?: readonly string[] | undefined
	readonly subject: string
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly inReplyTo?: string | undefined
	readonly references?: readonly string[] | undefined
	readonly headers?: Readonly<Record<string, string>> | undefined
	readonly attachments?: readonly OutboundAttachment[] | undefined
}
