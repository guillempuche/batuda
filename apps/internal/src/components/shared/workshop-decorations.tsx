import { styled } from 'next-yak'

/**
 * Screw/rivet dot — a tiny metal bead pinned to a surface corner or an
 * arbitrary offset. Used on file cards, header plates, work orders, and
 * toolbars to sell the "bolted-down" metaphor.
 *
 * Prefer the `$position` preset (`top-left`, `top-right`, `bottom-left`,
 * `bottom-right`) over inline `style={}` — it keeps placement in CSS and
 * avoids the render-time style object that defeats
 * class memoization.
 */

export type ScrewPosition =
	| 'top-left'
	| 'top-right'
	| 'bottom-left'
	| 'bottom-right'

export const ScrewDot = styled.span<{
	'data-position'?: ScrewPosition
	$size?: number
}>`
	position: absolute;
	width: ${p => p.$size ?? 6}px;
	height: ${p => p.$size ?? 6}px;
	border-radius: 50%;
	background: radial-gradient(
		circle at 35% 35%,
		var(--color-metal-light),
		var(--color-metal-deep)
	);
	box-shadow: inset 0 -1px 0 var(--shadow-color-deep);
	pointer-events: none;
	z-index: 2;

	/* Which corner it sits in is one of four, so each is its own rule rather
	 * than a value worked out as the page runs. */
	&[data-position='top-left'] {
		top: 8px;
		left: 8px;
	}
	&[data-position='top-right'] {
		top: 8px;
		right: 8px;
	}
	&[data-position='bottom-left'] {
		bottom: 8px;
		left: 8px;
	}
	&[data-position='bottom-right'] {
		bottom: 8px;
		right: 8px;
	}
`
