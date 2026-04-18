import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import {
	Briefcase,
	Calendar,
	Camera,
	Circle,
	FileSignature,
	FileText,
	Mail,
	MapPin,
	MessageCircle,
	Phone,
	Search,
	Settings,
} from 'lucide-react'

/**
 * Maps an interaction channel string (see `interactions.channel` in
 * `packages/domain/src/schema/interactions.ts`) to its Lucide icon.
 * Unknown values fall back to a neutral circle so rows never crash
 * on future/legacy channel names.
 *
 * Note: lucide-react v1 removed all branded logos (Instagram, Linkedin,
 * WhatsApp, …) for trademark reasons, so we substitute semantic
 * equivalents — Briefcase for LinkedIn (professional), Camera for
 * Instagram (visual), MessageCircle for WhatsApp.
 */
export type InteractionChannel =
	| 'phone'
	| 'email'
	| 'visit'
	| 'linkedin'
	| 'instagram'
	| 'whatsapp'
	| 'event'
	| 'document'
	| 'proposal'
	| 'research'
	| 'system'
	| 'other'

const channelIcons: Record<
	InteractionChannel,
	React.ComponentType<{ size?: number | string; 'aria-hidden'?: boolean }>
> = {
	phone: Phone,
	email: Mail,
	visit: MapPin,
	linkedin: Briefcase,
	instagram: Camera,
	whatsapp: MessageCircle,
	event: Calendar,
	document: FileText,
	proposal: FileSignature,
	research: Search,
	system: Settings,
	other: Circle,
}

const channelLabels: Record<InteractionChannel, MessageDescriptor> = {
	phone: msg`Call`,
	email: msg`Email`,
	visit: msg`Visit`,
	linkedin: msg`LinkedIn`,
	instagram: msg`Instagram`,
	whatsapp: msg`WhatsApp`,
	event: msg`Event`,
	document: msg`Document`,
	proposal: msg`Proposal`,
	research: msg`Research`,
	system: msg`System`,
	other: msg`Other`,
}

function asChannel(value: string): InteractionChannel {
	return value in channelIcons ? (value as InteractionChannel) : 'other'
}

export function channelLabelFor(channel: string): MessageDescriptor {
	return channelLabels[asChannel(channel)]
}

export function ChannelIcon({
	channel,
	size = 16,
}: {
	channel: InteractionChannel | string
	size?: number
}) {
	const normalized = asChannel(channel)
	const Icon = channelIcons[normalized]
	return <Icon size={size} aria-hidden />
}
