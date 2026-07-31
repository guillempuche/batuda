import { useLingui } from '@lingui/react/macro'

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
	return kind => {
		switch (kind) {
			case 'email':
				return t`Email`
			case 'phone':
				return t`Phone`
			case 'whatsapp':
				return t`WhatsApp`
			case 'website':
				return t`Website`
			case 'linkedin':
				return t`LinkedIn`
			case 'instagram':
				return t`Instagram`
			case 'x':
				return t`X`
			case 'bluesky':
				return t`Bluesky`
			// A platform this app has no word for is announced as it was stored,
			// which is more use than saying nothing.
			default:
				return kind
		}
	}
}
