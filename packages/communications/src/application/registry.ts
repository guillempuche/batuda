import {
	type Channel,
	type ChannelCapabilities,
	EMAIL_CAPABILITIES,
} from '../domain/channel'

// Capability descriptor per channel. Transports and inbound adapters are wired
// per-process (each app owns the concrete impls); this registry is the
// channel-agnostic metadata both processes share.
export const CHANNEL_CAPABILITIES: Record<Channel, ChannelCapabilities> = {
	email: EMAIL_CAPABILITIES,
}

export const capabilitiesFor = (channel: Channel): ChannelCapabilities =>
	CHANNEL_CAPABILITIES[channel]
