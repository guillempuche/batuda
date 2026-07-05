import type { Channel } from './channel'

// Email-specific fields that ride alongside the generic inbound shape. Kept in
// a sub-payload so the channel-generic core stays free of IMAP / RFC-5322
// concepts, present only when `channel === 'email'`.
export interface EmailInbound {
	readonly messageId: string
	readonly inReplyTo: string | null
	readonly references: readonly string[]
	readonly imapUid: number | null
	readonly imapUidvalidity: number | null
	readonly folder: string
}

// A normalized inbound message. A channel-specific parser produces it; the
// shared persist path consumes it.
export interface InboundMessage {
	readonly channel: Channel
	// The sender's address on the channel (email address, chat id, …).
	readonly from: string | null
	readonly to: readonly string[]
	readonly cc: readonly string[]
	readonly bcc: readonly string[]
	readonly subject: string | null
	readonly receivedAt: Date
	readonly textBody: string | null
	readonly htmlBody: string | null
	readonly textPreview: string | null
	// Present when `channel === 'email'`.
	readonly email?: EmailInbound
}
