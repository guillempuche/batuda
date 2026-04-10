import styled from 'styled-components'

/**
 * 8px colored dot representing company priority:
 *   1 (hot)    → --color-error (red)
 *   2 (medium) → --color-status-meeting (amber)
 *   3 (cold)   → --color-outline (neutral grey)
 *
 * Returns `null` for nullish input so callers don't need to guard.
 */
export function PriorityDot({
	priority,
}: {
	priority: number | null | undefined
}) {
	if (priority !== 1 && priority !== 2 && priority !== 3) return null
	return (
		<Dot $priority={priority} role='img' aria-label={`Priority ${priority}`} />
	)
}

const palette = {
	1: 'var(--color-error)',
	2: 'var(--color-status-meeting)',
	3: 'var(--color-outline)',
} as const

const Dot = styled.span.withConfig({
	displayName: 'PriorityDot',
	shouldForwardProp: prop => prop !== '$priority',
})<{ $priority: 1 | 2 | 3 }>`
	display: inline-block;
	width: 0.5rem;
	height: 0.5rem;
	border-radius: var(--shape-full);
	background: ${p => palette[p.$priority]};
	flex-shrink: 0;
`
