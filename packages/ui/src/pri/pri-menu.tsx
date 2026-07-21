import { Menu } from '@base-ui/react/menu'
import styled from 'styled-components'

/**
 * Workshop action menu — a brushed metal plate of actions opened from a button
 * trigger. Unlike PriSelect (which picks and persists a value), each item runs
 * an action or navigates. Use `Item` for a click action, `LinkItem` for a
 * navigation (renders a real `<a>`, so it is middle/cmd-clickable), and
 * `CheckboxItem` for a toggle that keeps the menu open.
 *
 *   <PriMenu.Root>
 *     <PriMenu.Trigger render={props => <PriButton {...props}>Inboxes</PriButton>} />
 *     <PriMenu.Portal>
 *       <PriMenu.Positioner sideOffset={6}>
 *         <PriMenu.Popup>
 *           <PriMenu.Item onClick={…}>Rename</PriMenu.Item>
 *           <PriMenu.LinkItem render={props => <Link to="/x" {...props} />}>Open</PriMenu.LinkItem>
 *         </PriMenu.Popup>
 *       </PriMenu.Positioner>
 *     </PriMenu.Portal>
 *   </PriMenu.Root>
 */

const PriPopup = styled(Menu.Popup).withConfig({
	displayName: 'PriMenuPopup',
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
	border: 1px solid var(--color-metal-edge);
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

// Shared row styling for every kind of menu item.
const itemStyles = `
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
	text-decoration: none;
	cursor: pointer;
	user-select: none;
	outline: none;
	white-space: nowrap;

	&[data-highlighted] {
		background: color-mix(in srgb, var(--color-highlight-amber), transparent);
		box-shadow: var(--glow-active);
	}

	&[data-disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const PriItem = styled(Menu.Item).withConfig({
	displayName: 'PriMenuItem',
})`
	${itemStyles}
`

const PriLinkItem = styled(Menu.LinkItem).withConfig({
	displayName: 'PriMenuLinkItem',
})`
	${itemStyles}
`

const PriCheckboxItem = styled(Menu.CheckboxItem).withConfig({
	displayName: 'PriMenuCheckboxItem',
})`
	${itemStyles}
	display: grid;
	grid-template-columns: 1rem 1fr;
`

const PriCheckboxItemIndicator = styled(Menu.CheckboxItemIndicator).withConfig({
	displayName: 'PriMenuCheckboxItemIndicator',
})`
	grid-column-start: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--color-primary);
`

const PriGroupLabel = styled(Menu.GroupLabel).withConfig({
	displayName: 'PriMenuGroupLabel',
})`
	padding: var(--space-2xs) var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const PriSeparator = styled(Menu.Separator).withConfig({
	displayName: 'PriMenuSeparator',
})`
	height: 1px;
	margin: var(--space-3xs) 0;
	background: linear-gradient(
		to right,
		transparent 0%,
		color-mix(in srgb, var(--color-on-surface) 22%, transparent) 50%,
		transparent 100%
	);
	border: none;
`

export const PriMenu = {
	Root: Menu.Root,
	Trigger: Menu.Trigger,
	Portal: Menu.Portal,
	Positioner: Menu.Positioner,
	Popup: PriPopup,
	Group: Menu.Group,
	GroupLabel: PriGroupLabel,
	Item: PriItem,
	LinkItem: PriLinkItem,
	CheckboxItem: PriCheckboxItem,
	CheckboxItemIndicator: PriCheckboxItemIndicator,
	Separator: PriSeparator,
}
