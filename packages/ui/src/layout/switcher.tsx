import { styled } from 'next-yak'

import { SPACE, type SpaceToken } from './tokens'

/**
 * Switcher — children share a row when the container is wider than
 * `$threshold`, and stack as a single column below it. The reflow is
 * driven by the container's intrinsic width, not a viewport media
 * query: a Switcher inside a Sidebar reflows when the Sidebar narrows,
 * not when the page does.
 *
 *   <Switcher $threshold="48rem" $gap="md">
 *     <NextActionCard />
 *     <CadenceCard />
 *     <UpcomingCard />
 *   </Switcher>
 *
 * Reference: every-layout.dev/layouts/switcher
 */
export const Switcher = styled.div<{
	$gap?: SpaceToken
	$threshold?: string
}>`
	display: flex;
	flex-wrap: wrap;
	gap: ${p => SPACE[p.$gap ?? 'md']};

	& > * {
		flex-grow: 1;
		flex-basis: calc((${p => p.$threshold ?? '40rem'} - 100%) * 999);
	}
`
