import { styled } from 'next-yak'

import { SPACE, type SpaceToken } from './tokens'

/**
 * Cover — fills at least `$minBlockSize` of vertical space and centres
 * its primary child; other children stack above and below. Mark the child
 * to centre with `data-cover-center`, or let it be the `<main>` element.
 *
 *   <Cover $minBlockSize="100vh">
 *     <Header />
 *     <main data-cover-center>Hero</main>
 *     <Footer />
 *   </Cover>
 *
 * Which child gets centred is fixed rather than passed in. A prop in
 * selector position is a value the styling can only learn while running,
 * so it rules out ever compiling these styles ahead of time — and marking
 * the child says the same thing at the place a reader is already looking.
 *
 * Reference: every-layout.dev/layouts/cover
 */
export const Cover = styled.div<{
	$gap?: SpaceToken
	$minBlockSize?: string
}>`
	display: flex;
	flex-direction: column;
	min-block-size: ${p => p.$minBlockSize ?? '100vh'};
	gap: ${p => SPACE[p.$gap ?? 'md']};

	& > :where([data-cover-center], main) {
		margin-block: auto;
	}
`
