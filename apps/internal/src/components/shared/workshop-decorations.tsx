import styled, { css } from 'styled-components'

/**
 * Screw/rivet dot — a tiny metal bead pinned to a surface corner or an
 * arbitrary offset. Used on file cards, header plates, work orders, and
 * toolbars to sell the "bolted-down" metaphor.
 *
 * Prefer the `$position` preset (`top-left`, `top-right`, `bottom-left`,
 * `bottom-right`) over inline `style={}` — it keeps placement in CSS and
 * avoids the render-time style object that defeats styled-components
 * class memoization.
 */

type ScrewPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const POSITION_OFFSETS: Record<ScrewPosition, ReturnType<typeof css>> = {
	'top-left': css`
		top: 8px;
		left: 8px;
	`,
	'top-right': css`
		top: 8px;
		right: 8px;
	`,
	'bottom-left': css`
		bottom: 8px;
		left: 8px;
	`,
	'bottom-right': css`
		bottom: 8px;
		right: 8px;
	`,
}

export const ScrewDot = styled.span.withConfig({
	displayName: 'ScrewDot',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{ $position?: ScrewPosition; $size?: number }>`
	position: absolute;
	width: ${p => p.$size ?? 6}px;
	height: ${p => p.$size ?? 6}px;
	border-radius: 50%;
	background: radial-gradient(
		circle at 35% 35%,
		var(--color-metal-light),
		var(--color-metal-deep)
	);
	box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.4);
	pointer-events: none;
	z-index: 2;

	${p => (p.$position ? POSITION_OFFSETS[p.$position] : '')}
`
