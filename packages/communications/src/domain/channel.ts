// The set of communication channels the spine can carry. Email is the only one
// wired today; a new channel (e.g. Telegram) adds a member here plus a
// `*_CAPABILITIES` descriptor below — no spine changes.
export type Channel = 'email'

// What a channel can and cannot do, so callers branch on capability instead of
// hard-coding per-channel rules.
export interface ChannelCapabilities {
	// How inbound arrives: a poll/IDLE worker ('pull') or an inbound webhook.
	readonly inboundMode: 'pull' | 'webhook'
	// A reply window applies (e.g. a 24h messaging window) that restricts
	// outbound sent outside it.
	readonly windowed: boolean
	// Cold outbound must use a pre-approved template.
	readonly templatesRequired: boolean
	// The channel can start a conversation without a prior inbound message.
	readonly coldOutbound: boolean
	// The channel has native threading / conversation semantics.
	readonly threads: boolean
}

export const EMAIL_CAPABILITIES: ChannelCapabilities = {
	inboundMode: 'pull',
	windowed: false,
	templatesRequired: false,
	coldOutbound: true,
	threads: true,
}
