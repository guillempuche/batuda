import { Popover } from '@base-ui/react/popover'
import styled from 'styled-components'

/**
 * Workshop popover — brushed metal plate with four screw dots and a small
 * metal-triangle arrow.
 *
 *   <PriPopover.Root>
 *     <PriPopover.Trigger />
 *     <PriPopover.Portal>
 *       <PriPopover.Positioner>
 *         <PriPopover.Popup>…</PriPopover.Popup>
 *       </PriPopover.Positioner>
 *     </PriPopover.Portal>
 *   </PriPopover.Root>
 */
const PriPopup = styled(Popover.Popup).withConfig({
	displayName: 'PriPopoverPopup',
})`
	position: relative;
	min-width: 12rem;
	padding: var(--space-sm) var(--space-md);
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	color: var(--color-on-surface);
	border: 1px solid rgba(0, 0, 0, 0.35);
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-md);
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

	/* Screw dots at corners */
	&::after {
		content: '';
		position: absolute;
		top: 6px;
		left: 6px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 35%,
			var(--color-metal-light),
			var(--color-metal-deep)
		);
		box-shadow:
			inset 0 -1px 0 rgba(0, 0, 0, 0.35),
			calc(100% - 5px) 0 0 0
				color-mix(in srgb, var(--color-metal-deep) 100%, transparent);
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: scale(0.96);
	}
`

const PriArrow = styled(Popover.Arrow).withConfig({
	displayName: 'PriPopoverArrow',
})`
	width: 10px;
	height: 10px;
	background: var(--color-metal);
	border: 1px solid rgba(0, 0, 0, 0.35);
	border-top: none;
	border-left: none;
	transform: rotate(45deg);
`

const PriTitle = styled(Popover.Title).withConfig({
	displayName: 'PriPopoverTitle',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-title-small-size);
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	text-shadow: var(--text-shadow-emboss);
	margin: 0 0 var(--space-2xs);
`

const PriDescription = styled(Popover.Description).withConfig({
	displayName: 'PriPopoverDescription',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

export const PriPopover = {
	Root: Popover.Root,
	Trigger: Popover.Trigger,
	Portal: Popover.Portal,
	Positioner: Popover.Positioner,
	Close: Popover.Close,
	Backdrop: Popover.Backdrop,
	Popup: PriPopup,
	Arrow: PriArrow,
	Title: PriTitle,
	Description: PriDescription,
}
