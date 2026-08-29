import { Autocomplete } from '@base-ui/react/autocomplete'
import styled from 'styled-components'

/**
 * Workshop-styled text box that suggests what other people have already typed,
 * without insisting on it. Compound export: `PriCombobox = { Root, Input, Icon,
 * Clear, Portal, Positioner, Popup, List, Item, Empty, Status }`.
 *
 * Built on Base UI's Autocomplete rather than its Combobox because the value
 * here is whatever was typed — the list narrows as you type and is there to be
 * ignored. A Combobox would only ever give back one of its own options, which
 * is the opposite of what a field like a trade name needs: the first person to
 * sell to boat builders has to be able to write it down.
 *
 * Lives in the app rather than `@batuda/ui` because it is the first and so far
 * only place that needs it; it moves to the package when a second one does.
 */

const PriInput = styled(Autocomplete.Input).withConfig({
	displayName: 'PriComboboxInput',
})`
	width: 100%;
	padding: var(--space-xs) var(--space-sm);
	background: var(--color-paper-aged);
	color: var(--color-on-surface);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	border-radius: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	box-shadow: inset 0 1px 2px var(--shadow-color-subtle);
	transition:
		border-color 160ms ease,
		background 160ms ease;

	&::placeholder {
		color: var(--color-on-surface-variant);
		opacity: 0.7;
		font-style: italic;
	}

	&:hover:not(:disabled) {
		border-bottom-color: var(--color-on-surface-variant);
	}

	&:focus,
	&:focus-visible {
		outline: none;
		border-bottom-color: var(--color-primary);
		background: var(--color-paper-aged-bright);
		box-shadow:
			inset 0 1px 2px var(--shadow-color-subtle),
			0 2px 0 -1px color-mix(in srgb, var(--color-primary) 40%, transparent);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--color-surface-container);
	}
`

const PriPopup = styled(Autocomplete.Popup).withConfig({
	displayName: 'PriComboboxPopup',
})`
	position: relative;
	/* Never narrower than the field it belongs to, or a suggestion reads as
	 * belonging to something else on the page; never wider than the screen has
	 * room for, or a long trade name would run off the side of a phone. */
	min-width: var(--anchor-width);
	max-width: var(--available-width);
	max-height: min(18rem, var(--available-height));
	overflow-y: auto;
	box-sizing: border-box;
	background-color: var(--color-metal);
	background-image:
		var(--texture-brushed-metal),
		linear-gradient(
			145deg,
			var(--color-metal-light) 0%,
			var(--color-metal) 55%,
			var(--color-metal-dark) 100%
		);
	border: 1px solid var(--color-metal-edge);
	border-radius: var(--shape-2xs);
	padding: var(--space-2xs);
	box-shadow: var(--elevation-workshop-lg);
	transform-origin: var(--transform-origin);
	transition:
		transform 160ms ease,
		opacity 160ms ease;

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: scale(0.96);
	}
`

const PriItem = styled(Autocomplete.Item).withConfig({
	displayName: 'PriComboboxItem',
})`
	position: relative;
	z-index: 1;
	/* A plain block, not a row of parts: a suggestion is one piece of text, and
	 * only text sitting directly in a block trails off with an ellipsis. */
	display: block;
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
	/* One line each, so the list widens to its longest suggestion rather than
	 * wrapping them all; past the width it may reach, a name trails off. */
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;

	&[data-highlighted] {
		background: color-mix(in srgb, var(--color-highlight-amber), transparent);
		box-shadow: var(--glow-active);
	}
`

const PriEmpty = styled(Autocomplete.Empty).withConfig({
	displayName: 'PriComboboxEmpty',
})`
	padding: var(--space-2xs) var(--space-sm);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);

	/* Base UI keeps this mounted with no children when the list has matches;
	 * padding on an empty box would read as a blank row. */
	&:empty {
		display: none;
	}
`

export const PriCombobox = {
	Root: Autocomplete.Root,
	Input: PriInput,
	Icon: Autocomplete.Icon,
	Clear: Autocomplete.Clear,
	Portal: Autocomplete.Portal,
	Positioner: Autocomplete.Positioner,
	Popup: PriPopup,
	List: Autocomplete.List,
	Item: PriItem,
	Empty: PriEmpty,
	Status: Autocomplete.Status,
}
