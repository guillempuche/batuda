import styled from 'styled-components'

/**
 * Frame — fixed aspect-ratio container that crops oversized children.
 * Default ratio is 16:9. Use for media (images, video, map previews)
 * that must keep their aspect even when the container resizes.
 *
 *   <Frame $ratio="4 / 3">
 *     <img src="…" alt="…" />
 *   </Frame>
 *
 * Reference: every-layout.dev/layouts/frame
 */
export const Frame = styled.div.withConfig({
	displayName: 'Frame',
	shouldForwardProp: prop => prop !== '$ratio',
})<{ $ratio?: string }>`
	aspect-ratio: ${p => p.$ratio ?? '16 / 9'};
	display: flex;
	overflow: hidden;
	align-items: center;
	justify-content: center;

	& > img,
	& > video {
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}
`
