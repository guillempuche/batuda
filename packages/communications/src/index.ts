// Communications bounded context entry point. Channel-agnostic value types +
// the transport port; both apps/server and apps/mail-worker import from here,
// and each wires its own concrete transports / inbound adapters.

// ── Application ──────────────────────────────────────────────────────────────
export type { ChannelTransport } from './application/channel-transport'
export {
	Ambiguous,
	CreatedBoth,
	CreatedContact,
	type CreatePolicy,
	type MatchArgs,
	MatchedCompanyOnly,
	MatchedContact,
	NoMatch,
	type ParticipantMatch,
	ParticipantMatcher,
} from './application/participant-matcher'
export { CHANNEL_CAPABILITIES, capabilitiesFor } from './application/registry'
// ── Domain ───────────────────────────────────────────────────────────────────
export {
	type Channel,
	type ChannelCapabilities,
	EMAIL_CAPABILITIES,
} from './domain/channel'
export type { EmailInbound, InboundMessage } from './domain/inbound-message'
export type {
	OutboundAttachment,
	OutboundMessage,
} from './domain/outbound-message'
export { type SendOutcome, Sent } from './domain/send-outcome'
