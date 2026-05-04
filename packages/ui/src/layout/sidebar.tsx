import styled, { css } from 'styled-components'

import type { SpaceToken } from './tokens'

type SidebarSide = 'left' | 'right'

/**
 * Sidebar — a two-column layout where one column has a fixed intrinsic
 * width and the other takes the remaining space. When the content
 * column would shrink below `$contentMin`, the layout collapses to a
 * single column (the side wraps below or above the content).
 *
 * Children are rendered in DOM order. The first child is the *content*
 * column, the second is the *side*. Set `$side="left"` to swap which
 * one appears on the left; default is `right` (content left, side right).
 *
 *   <Sidebar $side="right" $sideWidth="22rem" $contentMin="50%">
 *     <Activity />     // content
 *     <SidebarRail />  // side
 *   </Sidebar>
 *
 * Reference: every-layout.dev/layouts/sidebar
 */
export const Sidebar = styled.div.withConfig({
	displayName: 'Sidebar',
	shouldForwardProp: prop =>
		prop !== '$gap' &&
		prop !== '$side' &&
		prop !== '$sideWidth' &&
		prop !== '$contentMin',
})<{
	$gap?: SpaceToken
	$side?: SidebarSide
	$sideWidth?: string
	$contentMin?: string
}>`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-${p => p.$gap ?? 'md'});

	${p =>
		(p.$side ?? 'right') === 'right'
			? css`
					& > :first-child {
						flex-basis: 0;
						flex-grow: 999;
						min-inline-size: ${p.$contentMin ?? '50%'};
					}
					& > :last-child {
						flex-basis: ${p.$sideWidth ?? '18rem'};
						flex-grow: 1;
					}
				`
			: css`
					& > :first-child {
						flex-basis: ${p.$sideWidth ?? '18rem'};
						flex-grow: 1;
					}
					& > :last-child {
						flex-basis: 0;
						flex-grow: 999;
						min-inline-size: ${p.$contentMin ?? '50%'};
					}
				`}
`
