import { ContextMenu } from '@base-ui/react/context-menu'
import styled from 'styled-components'

/**
 * Workshop context menu — a brushed metal plate that pops up on right-click.
 * Items are uppercase display-font labels; highlighted rows fill with an
 * amber glow ring (matches the active nav treatment).
 *
 *   <PriContextMenu.Root>
 *     <PriContextMenu.Trigger>
 *       <CompanyCard />
 *     </PriContextMenu.Trigger>
 *     <PriContextMenu.Portal>
 *       <PriContextMenu.Positioner>
 *         <PriContextMenu.Popup>
 *           <PriContextMenu.Item onClick={…}>Edit</PriContextMenu.Item>
 *         </PriContextMenu.Popup>
 *       </PriContextMenu.Positioner>
 *     </PriContextMenu.Portal>
 *   </PriContextMenu.Root>
 */
const PriPopup = styled(ContextMenu.Popup).withConfig({
	displayName: 'PriContextMenuPopup',
})`
	position: relative;
	min-width: 12rem;
	padding: var(--space-2xs);
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	color: var(--color-on-surface);
	border: 1px solid rgba(0, 0, 0, 0.35);
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-lg);
	transform-origin: var(--transform-origin);
	transition:
		opacity 160ms ease,
		transform 200ms cubic-bezier(0.22, 1.2, 0.4, 1);

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--texture-brushed-metal);
		pointer-events: none;
	}

	& > * {
		position: relative;
		z-index: 1;
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: scale(0.96);
	}
`

const PriItem = styled(ContextMenu.Item).withConfig({
	displayName: 'PriContextMenuItem',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--font-weight-medium);
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	cursor: pointer;
	user-select: none;
	outline: none;

	&[data-highlighted] {
		background: color-mix(in srgb, rgba(245, 158, 11, 0.28), transparent);
		box-shadow: var(--glow-active);
	}

	&[data-disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const PriGroupLabel = styled(ContextMenu.GroupLabel).withConfig({
	displayName: 'PriContextMenuGroupLabel',
})`
	padding: var(--space-2xs) var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

export const PriContextMenu = {
	Root: ContextMenu.Root,
	Trigger: ContextMenu.Trigger,
	Portal: ContextMenu.Portal,
	Positioner: ContextMenu.Positioner,
	Backdrop: ContextMenu.Backdrop,
	Group: ContextMenu.Group,
	GroupLabel: PriGroupLabel,
	Popup: PriPopup,
	Item: PriItem,
	Separator: ContextMenu.Separator,
}
