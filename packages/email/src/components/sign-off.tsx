import { Text } from '@react-email/components'

import { brandTheme } from '../theme'

// One-line sign-off stamp. Uppercase · letter-spaced · Barlow Condensed
// · muted color. No <Hr> above — a rule reads as transactional chrome.
// Effects like text-shadow emboss, clip-path, and var() colors do not
// survive email-client CSS stripping, so the styles stay flat.

export interface SignOffProps {
	readonly author?: string | undefined
	readonly brand?: string | undefined
	readonly city?: string | undefined
}

export const SignOff = ({ author, brand, city }: SignOffProps) => {
	const parts = [author, brand, city].filter((p): p is string => !!p)
	if (parts.length === 0) return null
	return <Text style={brandTheme.signOff}>{parts.join(' · ')}</Text>
}
