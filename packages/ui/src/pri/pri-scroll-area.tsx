import { ScrollArea } from '@base-ui/react/scroll-area'
import { styled } from 'next-yak'

/**
 * Workshop scroll area — metal rail scrollbar with a brushed thumb that
 * looks like a slider running down a rail. Wrap any scrollable region:
 *
 *   <PriScrollArea.Root>
 *     <PriScrollArea.Viewport>
 *       <PriScrollArea.Content>{children}</PriScrollArea.Content>
 *     </PriScrollArea.Viewport>
 *     <PriScrollArea.Scrollbar orientation="vertical">
 *       <PriScrollArea.Thumb />
 *     </PriScrollArea.Scrollbar>
 *   </PriScrollArea.Root>
 *
 * `Content` installs the ResizeObserver that recomputes thumb size when
 * children resize (lazy images, i18n string swaps, dynamic sections).
 * Skipping it leaves the thumb stale.
 *
 * Gotcha for vertical-only scroll: `Content` ships with inline
 * `min-width: fit-content` so horizontal overflow is measurable. If your
 * children have no width cap (e.g. responsive marketing sections), this
 * blows the layout out to intrinsic width. Override with
 * `<PriScrollArea.Content style={{ minWidth: 0 }}>` when you don't need
 * horizontal-overflow detection.
 */
const PriRoot = styled(ScrollArea.Root)`
	position: relative;
	overflow: hidden;
	width: 100%;
	height: 100%;
`

const PriViewport = styled(ScrollArea.Viewport)`
	width: 100%;
	height: 100%;
	/* Contain only the y-axis. Containing the x-axis swallows the macOS
	 * two-finger swipe-back gesture at the left edge of the viewport. */
	overscroll-behavior-y: contain;
`

const PriScrollbar = styled(ScrollArea.Scrollbar)`
	display: flex;
	touch-action: none;
	user-select: none;
	padding: 2px;
	background:
		linear-gradient(
			90deg,
			var(--shadow-color-deep) 0%,
			var(--shadow-color-subtle) 50%,
			var(--shadow-color-deep) 100%
		),
		linear-gradient(
			180deg,
			var(--color-metal-deep) 0%,
			var(--color-metal-deepest) 50%,
			var(--color-metal-deep) 100%
		);
	border-left: 1px solid var(--color-metal-edge-strong);
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

const PriThumb = styled(ScrollArea.Thumb)`
	position: relative;
	flex: 1;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid var(--color-metal-edge-strong);
	border-radius: 2px;
	box-shadow:
		inset 0 1px 0 var(--highlight-inset-bright),
		0 1px 2px var(--shadow-color-deep);

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
		box-shadow: inset 0 -1px 0 var(--shadow-color-deep);
	}

	&::before {
		top: 6px;
	}

	&::after {
		bottom: 6px;
	}
`

const PriCorner = styled(ScrollArea.Corner)`
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
