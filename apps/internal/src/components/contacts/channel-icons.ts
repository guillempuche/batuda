import {
	AtSign,
	Briefcase,
	Globe,
	Mail,
	type Mail as MailIcon,
	MessageCircle,
	Phone,
} from 'lucide-react'

// `kind` is open-ended, so a platform nobody has drawn an icon for falls back
// to a plain link at the call site rather than being hidden.
export const CHANNEL_ICON: Record<string, typeof MailIcon> = {
	email: Mail,
	phone: Phone,
	whatsapp: MessageCircle,
	linkedin: Briefcase,
	x: AtSign,
	instagram: AtSign,
	website: Globe,
	bluesky: AtSign,
}
