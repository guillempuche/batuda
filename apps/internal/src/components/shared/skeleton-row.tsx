import styled, { css, keyframes } from 'styled-components'

import { agedPaperRow, ruledLedgerRow } from '#/lib/workshop-mixins'

/**
 * Aged-paper skeleton row stack. The shimmer is gated behind
 * `prefers-reduced-motion` via a CSS media query so callers do not need
 * to read the motion preference themselves.
 */
export function SkeletonRows({
	count = 6,
	height = '3rem',
}: {
	count?: number
	height?: string
}) {
	const keys = skeletonKeys(count)
	return (
		<SkeletonList role='status' aria-live='polite' aria-busy='true'>
			{keys.map(key => (
				<SkeletonBar key={key} style={{ height }} />
			))}
		</SkeletonList>
	)
}

function skeletonKeys(count: number): ReadonlyArray<string> {
	const out: Array<string> = []
	for (let i = 0; i < count; i++) out.push(`skeleton-${i}`)
	return out
}

const shimmer = keyframes`
	0%   { background-position: -200% 0; }
	100% { background-position: 200% 0; }
`

const SkeletonList = styled.div.withConfig({
	displayName: 'SkeletonRowsList',
})`
	display: flex;
	flex-direction: column;
	gap: 0;
`

const shimmerBg = css`
	background: linear-gradient(
		90deg,
		color-mix(in oklab, var(--color-paper-aged) 100%, transparent) 0%,
		color-mix(in oklab, var(--color-paper-aged-hover, var(--color-paper-aged))
				40%, var(--color-paper-aged)) 50%,
		color-mix(in oklab, var(--color-paper-aged) 100%, transparent) 100%
	);
	background-size: 200% 100%;
	animation: ${shimmer} 1600ms linear infinite;

	@media (prefers-reduced-motion: reduce) {
		animation: none;
	}
`

const SkeletonBar = styled.div.withConfig({
	displayName: 'SkeletonRowsBar',
})`
	${agedPaperRow}
	${ruledLedgerRow}
	${shimmerBg}
	opacity: 0.75;
`
