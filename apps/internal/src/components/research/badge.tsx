import styled from 'styled-components'

import type { Tone } from './proposal-logic'

export type { Tone }

/**
 * Shared pill used by the trust and outcome badges. A good outcome has its own
 * name, `--color-success`, whose value sits in the olive family — so a reader
 * of this map can tell "this passed" from "this is the second accent" without
 * the two-accent palette gaining a third hue. Info borrows the same olive but
 * means something else, attention reads terracotta, failure reads the error
 * red, and the rest stay muted.
 */
const TONE_ACCENT: Record<Tone, string> = {
	positive: 'var(--color-success)',
	info: 'var(--color-secondary)',
	caution: 'var(--color-primary)',
	negative: 'var(--color-error)',
	neutral: 'var(--color-on-surface-variant)',
}

/** The accent a tone reads in, so anything showing a status colours it the same
 * way the badge beside it does. */
export const toneColor = (tone: Tone): string => TONE_ACCENT[tone]

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
