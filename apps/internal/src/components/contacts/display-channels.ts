// Pure helpers for rendering a contact's channels. Channels are the single
// source of truth for reachable addresses; the API ships them as a json_agg
// array whose keys stay snake_case (the pg camelCase transform only touches
// top-level columns, not nested json), so the narrower reads snake_case.

export type EmailChannelStatus = 'unknown' | 'valid' | 'bounced' | 'complained'

export type DisplayChannel = {
	readonly id: string
	readonly kind: string
	readonly value: string
	readonly verification: string | null
	readonly isPrimary: boolean
	readonly status: EmailChannelStatus
	readonly statusReason: string | null
}

const asEmailStatus = (value: unknown): EmailChannelStatus =>
	value === 'valid' || value === 'bounced' || value === 'complained'
		? value
		: 'unknown'

/** Parse the json_agg'd channels into a typed list (already primary-first from SQL). */
export function narrowChannels(raw: unknown): ReadonlyArray<DisplayChannel> {
	if (!Array.isArray(raw)) return []
	const out: Array<DisplayChannel> = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const r = entry as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['kind'] !== 'string') continue
		if (typeof r['value'] !== 'string') continue
		out.push({
			id: r['id'],
			kind: r['kind'],
			value: r['value'],
			verification:
				typeof r['verification'] === 'string' ? r['verification'] : null,
			isPrimary: r['is_primary'] === true,
			status: asEmailStatus(r['status']),
			statusReason:
				typeof r['status_reason'] === 'string' ? r['status_reason'] : null,
		})
	}
	return out
}

/** The email channel that drives the send address + suppression badge. */
export function primaryEmailChannel(
	channels: ReadonlyArray<DisplayChannel>,
): DisplayChannel | undefined {
	return (
		channels.find(c => c.kind === 'email' && c.isPrimary) ??
		channels.find(c => c.kind === 'email')
	)
}

// Where a channel value points + whether it opens off-site, so each channel
// renders as a working link regardless of platform. A bare handle (no scheme)
// is expanded to the platform's profile URL; a full URL is passed through.
export function channelHref(
	kind: string,
	value: string,
): { readonly href: string; readonly external: boolean } {
	const v = value.trim()
	const isUrl = /^https?:\/\//i.test(v)
	switch (kind) {
		case 'email':
			return { href: `mailto:${v}`, external: false }
		case 'phone':
			return { href: `tel:${v}`, external: false }
		case 'whatsapp':
			return {
				href: `https://wa.me/${v.replace(/[^0-9]/g, '')}`,
				external: true,
			}
		case 'linkedin':
			return {
				href: isUrl ? v : `https://www.linkedin.com/in/${v}`,
				external: true,
			}
		case 'x':
			return {
				href: isUrl ? v : `https://x.com/${v.replace(/^@/, '')}`,
				external: true,
			}
		case 'instagram':
			return {
				href: isUrl ? v : `https://instagram.com/${v.replace(/^@/, '')}`,
				external: true,
			}
		default:
			return { href: isUrl ? v : `https://${v}`, external: true }
	}
}
