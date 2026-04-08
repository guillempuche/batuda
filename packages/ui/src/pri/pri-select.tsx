import { Select } from '@base-ui/react/select'
import styled from 'styled-components'

/* Neutral defaults — only structural tokens (shape, focus ring, spacing,
 * typescale, transitions). No theme-specific gradients, textures, or accent
 * colors. Consumers compose styled overrides on top to apply their own
 * visual language (e.g. marketing's metal-skin wrappers). */

const PriTrigger = styled(Select.Trigger).withConfig({
	displayName: 'PriSelectTrigger',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-3xs) var(--space-xs);
	background: var(--color-surface);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface);
	cursor: pointer;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const PriPopup = styled(Select.Popup).withConfig({
	displayName: 'PriSelectPopup',
})`
	background: var(--color-surface);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-xs);
	padding: var(--space-3xs);
	transform-origin: var(--transform-origin);
	transition:
		transform 150ms,
		opacity 150ms;

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: scale(0.95);
	}
`

const PriItem = styled(Select.Item).withConfig({
	displayName: 'PriSelectItem',
})`
	display: grid;
	grid-template-columns: 1rem 1fr;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface);
	cursor: pointer;
	user-select: none;
	outline: none;

	&[data-highlighted] {
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
	}
`

const PriItemIndicator = styled(Select.ItemIndicator).withConfig({
	displayName: 'PriSelectItemIndicator',
})`
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--color-primary);
`

/* Compound primitive that mirrors Base UI's Select namespace.
 * Structural parts (Root, Portal, Positioner, Value, Icon, Label, List,
 * ItemText) are re-exported as-is. Visual parts (Trigger, Popup, Item,
 * ItemIndicator) come pre-styled with neutral design tokens. */
export const PriSelect = {
	Root: Select.Root,
	Portal: Select.Portal,
	Positioner: Select.Positioner,
	Value: Select.Value,
	Icon: Select.Icon,
	Label: Select.Label,
	List: Select.List,
	ItemText: Select.ItemText,
	Trigger: PriTrigger,
	Popup: PriPopup,
	Item: PriItem,
	ItemIndicator: PriItemIndicator,
}
