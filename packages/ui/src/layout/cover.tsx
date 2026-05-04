import styled from 'styled-components'

import type { SpaceToken } from './tokens'

/**
 * Cover — fills at least `$minBlockSize` of vertical space and centres
 * its primary child (selected by `$centeredSelector`, default `:where(
 * [data-cover-center], main)`); other children stack above and below.
 *
 *   <Cover $minBlockSize="100vh">
 *     <Header />
 *     <main data-cover-center>Hero</main>
 *     <Footer />
 *   </Cover>
 *
 * Reference: every-layout.dev/layouts/cover
 */
export const Cover = styled.div.withConfig({
	displayName: 'Cover',
	shouldForwardProp: prop =>
		prop !== '$gap' && prop !== '$minBlockSize' && prop !== '$centeredSelector',
})<{
	$gap?: SpaceToken
	$minBlockSize?: string
	$centeredSelector?: string
}>`
	display: flex;
	flex-direction: column;
	min-block-size: ${p => p.$minBlockSize ?? '100vh'};
	gap: var(--space-${p => p.$gap ?? 'md'});

	& > ${p => p.$centeredSelector ?? ':where([data-cover-center], main)'} {
		margin-block: auto;
	}
`
