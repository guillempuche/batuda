import {
	AtSign,
	Briefcase,
	Globe,
	Mail,
	type Mail as MailIcon,
	MessageCircle,
	Phone,
} from 'lucide-react'

import type { ChannelKind } from '@batuda/domain'

// `kind` is open-ended, so a platform nobody has drawn an icon for falls back
// to a plain link at the call site rather than being hidden. Every kind the
// picker offers must have one, which is what the check against CHANNEL_KINDS
// says — the lookup stays open so the fallback still works.
export const CHANNEL_ICON: Record<string, typeof MailIcon> = {
	email: Mail,
	phone: Phone,
	whatsapp: MessageCircle,
	linkedin: Briefcase,
	x: AtSign,
	instagram: AtSign,
	website: Globe,
	bluesky: AtSign,
} satisfies Record<ChannelKind, typeof MailIcon>
