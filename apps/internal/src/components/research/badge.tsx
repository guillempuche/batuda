import styled from 'styled-components'

import type { Tone } from './proposal-logic'

/**
 * Shared pill used by the trust and outcome badges. The two-accent workshop
 * palette (terracotta + olive) has no dedicated warning colour, so tones map
 * onto it: success/info read olive, attention reads terracotta, failure reads
 * the error red, and the rest stay muted.
 */
const TONE_ACCENT: Record<Tone, string> = {
	positive: 'var(--color-secondary)',
	info: 'var(--color-secondary)',
	caution: 'var(--color-primary)',
	negative: 'var(--color-error, #c6664b)',
	neutral: 'var(--color-on-surface-variant)',
}

export const Badge = styled.span.withConfig({
	displayName: 'ResearchBadge',
	shouldForwardProp: prop => prop !== '$tone',
})<{ $tone: Tone }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	white-space: nowrap;
	color: ${p => TONE_ACCENT[p.$tone]};
	background: color-mix(in oklab, ${p => TONE_ACCENT[p.$tone]} 14%, transparent);
	border: 1px solid
		color-mix(in oklab, ${p => TONE_ACCENT[p.$tone]} 40%, transparent);
`
