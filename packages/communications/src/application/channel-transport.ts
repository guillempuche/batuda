import type { Effect } from 'effect'

import type { ChannelCapabilities } from '../domain/channel'
import type { OutboundMessage } from '../domain/outbound-message'
import type { SendOutcome } from '../domain/send-outcome'

// A single per-connection transport for one channel. Generic over the
// connection type each channel speaks (email = decrypted IMAP/SMTP creds) and
// the failure type its wire raises, so a concrete transport conforms
// structurally with no error remapping. Email's `MailTransport` is the first
// implementation; a future channel supplies its own connection + error types.
export interface ChannelTransport<Conn, E = never> {
	readonly capabilities: ChannelCapabilities
	readonly probe: (connection: Conn) => Effect.Effect<void, E>
	readonly send: (
		connection: Conn,
		message: OutboundMessage,
	) => Effect.Effect<SendOutcome, E>
	// Best-effort mirror of a sent message into the channel's "sent" store.
	// Absent for channels with no such concept (e.g. the local dev catcher).
	readonly appendToSent?: (
		connection: Conn,
		raw: Uint8Array,
	) => Effect.Effect<void, E>
}
