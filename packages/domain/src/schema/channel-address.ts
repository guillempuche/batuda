/**
 * What a way of reaching someone has to look like.
 *
 * The same address can arrive as a company field ("the company's email"), as a
 * channel row on a person, or as a value a research run wants to write. All three
 * are the same question, so they read the shape from here — otherwise the write
 * that goes through one door is refused while the identical write through another
 * is kept, and the two answers drift apart quietly.
 *
 * The kind of channel is deliberately open: email, phone, linkedin, x, website,
 * bluesky and whatever comes next, so a new platform needs no change here. A kind
 * nobody has written a shape for is accepted as-is — an unknown kind is not the
 * same thing as a wrong value.
 */

/**
 * The kinds the app knows how to show: what the picker offers, and what has an
 * icon and a name to be read out. Storage still takes any kind — this is
 * presentation, not permission, and one arriving from elsewhere is shown as it
 * was stored rather than refused.
 *
 * It is one list because it was three, and they could drift: a kind could be
 * offered with no icon, or given a name nothing offered. The icon and name maps
 * are checked against this, so a gap is a build error rather than a blank space
 * on screen. The address shapes below and the link-building elsewhere stay
 * deliberately partial — most kinds need no shape, and most links are just the
 * value.
 */
export const CHANNEL_KINDS = [
	'email',
	'phone',
	'whatsapp',
	'linkedin',
	'x',
	'instagram',
	'facebook',
	'website',
	'bluesky',
] as const

export type ChannelKind = (typeof CHANNEL_KINDS)[number]

export const EMAIL_ADDRESS_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const PHONE_ADDRESS_PATTERN = /^\+?[0-9][0-9 ().-]{5,19}$/
// A bare host ("acme.com") counts as well as a full address, because that is how
// a website is most often written down.
export const WEBSITE_ADDRESS_PATTERN =
	/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i
export const INSTAGRAM_ADDRESS_PATTERN =
	/^(@?[A-Za-z0-9._]{1,30}|https?:\/\/(www\.)?instagram\.com\/.+)$/
export const LINKEDIN_ADDRESS_PATTERN =
	/^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/.+$/i
// Something has to follow the host, so the platform's own home page is not an
// address for anybody. Any subdomain counts, since Facebook serves each country
// and the phone from its own ("es-la.facebook.com", "m.facebook.com") and that
// is the address a person copies.
export const FACEBOOK_ADDRESS_PATTERN =
	/^(https?:\/\/)?([a-z0-9-]+\.)*facebook\.com\/.+$/i
export const MAPS_ADDRESS_PATTERN =
	/^https?:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl)\/.+/i

const BY_KIND: Record<string, RegExp> = {
	email: EMAIL_ADDRESS_PATTERN,
	phone: PHONE_ADDRESS_PATTERN,
	whatsapp: PHONE_ADDRESS_PATTERN,
	website: WEBSITE_ADDRESS_PATTERN,
	instagram: INSTAGRAM_ADDRESS_PATTERN,
	linkedin: LINKEDIN_ADDRESS_PATTERN,
	facebook: FACEBOOK_ADDRESS_PATTERN,
}

/**
 * Whether an address is a plausible one of its kind. True for any kind nothing
 * here describes, so adding a platform never starts refusing its addresses.
 */
export const channelAddressIsValid = (
	kind: string,
	address: string,
): boolean => {
	const pattern = BY_KIND[kind.trim().toLowerCase()]
	return pattern === undefined ? true : pattern.test(address.trim())
}
