import { ScrollArea } from '@base-ui/react/scroll-area'
import styled from 'styled-components'

/**
 * Workshop scroll area — metal rail scrollbar with a brushed thumb that
 * looks like a slider running down a rail. Wrap any scrollable region:
 *
 *   <PriScrollArea.Root>
 *     <PriScrollArea.Viewport>{children}</PriScrollArea.Viewport>
 *     <PriScrollArea.Scrollbar orientation="vertical">
 *       <PriScrollArea.Thumb />
 *     </PriScrollArea.Scrollbar>
 *   </PriScrollArea.Root>
 */
const PriRoot = styled(ScrollArea.Root).withConfig({
	displayName: 'PriScrollAreaRoot',
})`
	position: relative;
	overflow: hidden;
	width: 100%;
	height: 100%;
`

const PriViewport = styled(ScrollArea.Viewport).withConfig({
	displayName: 'PriScrollAreaViewport',
})`
	width: 100%;
	height: 100%;
	overscroll-behavior: contain;
`

const PriScrollbar = styled(ScrollArea.Scrollbar).withConfig({
	displayName: 'PriScrollAreaScrollbar',
})`
	display: flex;
	touch-action: none;
	user-select: none;
	padding: 2px;
	background:
		linear-gradient(
			90deg,
			rgba(0, 0, 0, 0.25) 0%,
			rgba(0, 0, 0, 0.08) 50%,
			rgba(0, 0, 0, 0.25) 100%
		),
		linear-gradient(
			180deg,
			var(--color-metal-deep) 0%,
			#4a433a 50%,
			var(--color-metal-deep) 100%
		);
	border-left: 1px solid rgba(0, 0, 0, 0.4);
	transition:
		width 160ms ease,
		background 160ms ease;

	&[data-orientation='vertical'] {
		width: 10px;
		height: 100%;
	}

	&[data-orientation='horizontal'] {
		height: 10px;
		width: 100%;
		flex-direction: column;
	}

	&:hover,
	&[data-hovering] {
		&[data-orientation='vertical'] {
			width: 14px;
		}
		&[data-orientation='horizontal'] {
			height: 14px;
		}
	}
`

const PriThumb = styled(ScrollArea.Thumb).withConfig({
	displayName: 'PriScrollAreaThumb',
})`
	position: relative;
	flex: 1;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.4);
	border-radius: 2px;
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.5),
		0 1px 2px rgba(0, 0, 0, 0.25);

	&::before,
	&::after {
		content: '';
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 35%,
			var(--color-metal-light),
			var(--color-metal-deep)
		);
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.35);
	}

	&::before {
		top: 6px;
	}

	&::after {
		bottom: 6px;
	}
`

const PriCorner = styled(ScrollArea.Corner).withConfig({
	displayName: 'PriScrollAreaCorner',
})`
	background: var(--color-metal-deep);
`

export const PriScrollArea = {
	Root: PriRoot,
	Viewport: PriViewport,
	Content: ScrollArea.Content,
	Scrollbar: PriScrollbar,
	Thumb: PriThumb,
	Corner: PriCorner,
}
