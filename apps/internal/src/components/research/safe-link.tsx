import styled from 'styled-components'

/**
 * Links to addresses that came out of a research run.
 *
 * Two reasons this is not a plain anchor. The address was read off a page the
 * run found, so it is not trusted: only ordinary web and mail addresses become
 * links, and anything else is shown as text rather than made clickable — a
 * "link" that runs code the moment it is clicked would otherwise be one click
 * away inside a signed-in page. And the app's baseline styling strips colour and
 * underline from anchors, so a link with no styling of its own is invisible;
 * these carry their own, always underlined, so a reader can tell what is
 * clickable.
 */

/** Web and mail addresses only — everything else is not a link. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * The address if it is safe to link to, otherwise null. A value with no protocol
 * at all is read as a bare domain and offered over https.
 */
export function safeHref(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	if (trimmed === '') return null
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
		? trimmed
		: `https://${trimmed}`
	try {
		const url = new URL(candidate)
		return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null
	} catch {
		return null
	}
}

/**
 * Render an address found by a run: a link when it can be followed safely, plain
 * text when it cannot, so nothing is silently dropped from the page.
 */
export function SafeLink({
	href,
	children,
	newTab = true,
}: {
	readonly href: string | null | undefined
	readonly children?: React.ReactNode
	/** Mail addresses open in place; web addresses open in a new tab. */
	readonly newTab?: boolean
}) {
	const safe = safeHref(href)
	const label = children ?? href ?? ''
	if (safe === null) return <Plain>{label}</Plain>
	const isMail = safe.startsWith('mailto:')
	return (
		<Anchor
			href={safe}
			{...(newTab && !isMail
				? { target: '_blank', rel: 'noreferrer noopener' }
				: {})}
		>
			{label}
		</Anchor>
	)
}

const Anchor = styled.a`
	color: var(--color-primary);
	text-decoration: underline;

	&:hover {
		text-decoration-thickness: 2px;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-3xs);
	}
`

const Plain = styled.span`
	color: var(--color-on-surface-variant);
	word-break: break-word;
`
