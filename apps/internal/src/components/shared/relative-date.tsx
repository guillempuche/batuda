import styled from 'styled-components'

/**
 * Relative date formatter using `Intl.RelativeTimeFormat` in English.
 * Accepts a `Date`, an ISO string, or a Unix timestamp. Renders
 * semantically as a `<time>` element with the ISO `datetime` attribute
 * so screen readers and copy-paste actions get the absolute value.
 *
 * Examples: "today", "yesterday", "3 days ago", "2 weeks ago", "in 5 days".
 */
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

type RelativeDateInput = Date | string | number | null | undefined

export function RelativeDate({
	value,
	fallback = '—',
}: {
	value: RelativeDateInput
	fallback?: string
}) {
	if (value === null || value === undefined || value === '') {
		return <Muted>{fallback}</Muted>
	}

	const date = value instanceof Date ? value : new Date(value)
	if (Number.isNaN(date.getTime())) {
		return <Muted>{fallback}</Muted>
	}

	const label = formatRelative(date)
	return (
		<Time dateTime={date.toISOString()} title={date.toLocaleString('en')}>
			{label}
		</Time>
	)
}

function formatRelative(date: Date): string {
	const diffMs = date.getTime() - Date.now()
	const diffSec = Math.round(diffMs / 1000)

	const minute = 60
	const hour = 3600
	const day = 86400
	const week = day * 7
	const month = day * 30
	const year = day * 365

	const abs = Math.abs(diffSec)
	if (abs < minute) return rtf.format(Math.round(diffSec), 'second')
	if (abs < hour) return rtf.format(Math.round(diffSec / minute), 'minute')
	if (abs < day) return rtf.format(Math.round(diffSec / hour), 'hour')
	if (abs < week) return rtf.format(Math.round(diffSec / day), 'day')
	if (abs < month) return rtf.format(Math.round(diffSec / week), 'week')
	if (abs < year) return rtf.format(Math.round(diffSec / month), 'month')
	return rtf.format(Math.round(diffSec / year), 'year')
}

const Time = styled.time.withConfig({ displayName: 'RelativeDateTime' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	letter-spacing: var(--typescale-label-medium-tracking);
	color: var(--color-on-surface-variant);
`

const Muted = styled.span.withConfig({ displayName: 'RelativeDateMuted' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	color: var(--color-on-surface-variant);
	opacity: 0.6;
`
