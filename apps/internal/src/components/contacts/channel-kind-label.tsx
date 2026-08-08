import { useLingui } from '@lingui/react/macro'

import type { ChannelKind } from '@batuda/domain'

/**
 * What kind of way of being reached this is, in words.
 *
 * The icon beside an address is decoration: three platforms share one drawing,
 * so it cannot say which of them an address belongs to, and a reader who hears
 * the page rather than sees it gets nothing from it at all. The words are what
 * carries the answer, whether they are shown or only announced.
 *
 * Read through a hook rather than a constant map so they are translated at
 * render time, in the reader's language, rather than frozen at module load.
 */
export const useChannelKindLabel = (): ((kind: string) => string) => {
	const { t } = useLingui()
	// Checked against CHANNEL_KINDS so a kind the picker offers cannot end up
	// without a word, while the lookup itself stays open.
	const labels: Record<string, string> = {
		email: t`Email`,
		phone: t`Phone`,
		whatsapp: t`WhatsApp`,
		website: t`Website`,
		linkedin: t`LinkedIn`,
		instagram: t`Instagram`,
		x: t`X`,
		bluesky: t`Bluesky`,
	} satisfies Record<ChannelKind, string>
	// A platform this app has no word for is announced as it was stored, which is
	// more use than saying nothing.
	return kind => labels[kind] ?? kind
}
