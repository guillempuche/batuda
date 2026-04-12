import { Select } from '@base-ui/react/select'
import styled from 'styled-components'

/**
 * Workshop select — stamped metal trigger + metal popup plate with screw
 * dots at the corners. Item highlight fills with a warm amber glow ring.
 * Consumers can still compose on top via `styled(PriSelect.Trigger)` if a
 * surface needs a different tint, but by default the workshop look lands
 * without extra work.
 */

const PriTrigger = styled(Select.Trigger).withConfig({
	displayName: 'PriSelectTrigger',
})`
	position: relative;
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.3);
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	cursor: pointer;
	transition:
		box-shadow 140ms ease,
		transform 140ms ease;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--texture-brushed-metal);
		pointer-events: none;
		border-radius: inherit;
	}

	& > * {
		position: relative;
		z-index: 1;
	}

	&:hover:not(:disabled) {
		box-shadow: var(--elevation-workshop-md);
	}

	&:active:not(:disabled) {
		transform: translateY(1px);
		box-shadow: var(--elevation-workshop-sm);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const PriPopup = styled(Select.Popup).withConfig({
	displayName: 'PriSelectPopup',
})`
	position: relative;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.35);
	border-radius: var(--shape-2xs);
	padding: var(--space-2xs);
	box-shadow: var(--elevation-workshop-lg);
	transform-origin: var(--transform-origin);
	transition:
		transform 160ms ease,
		opacity 160ms ease;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--texture-brushed-metal);
		pointer-events: none;
		border-radius: inherit;
	}

	/* Screw dots at corners */
	&::after {
		content: '';
		position: absolute;
		top: 5px;
		right: 5px;
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
			-17rem 0 0 0
				color-mix(
					in srgb,
					var(--color-metal-deep) 100%,
					transparent
				);
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: scale(0.96);
	}
`

const PriItem = styled(Select.Item).withConfig({
	displayName: 'PriSelectItem',
})`
	position: relative;
	z-index: 1;
	display: grid;
	grid-template-columns: 1rem 1fr;
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
`

const PriItemIndicator = styled(Select.ItemIndicator).withConfig({
	displayName: 'PriSelectItemIndicator',
})`
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--color-primary);
`

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
