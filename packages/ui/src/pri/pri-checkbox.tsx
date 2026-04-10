import { Checkbox } from '@base-ui/react/checkbox'
import styled from 'styled-components'

/**
 * Neutral checkbox primitive following Base UI's compound namespace.
 * Visually significant parts (Root, Indicator) come pre-styled with
 * design tokens; consumers compose label + error text around them at
 * the call site.
 *
 * Usage:
 *   <PriCheckbox.Root checked={done} onCheckedChange={setDone}>
 *     <PriCheckbox.Indicator>
 *       <Check size={14} />
 *     </PriCheckbox.Indicator>
 *   </PriCheckbox.Root>
 */
const PriRoot = styled(Checkbox.Root).withConfig({
	displayName: 'PriCheckboxRoot',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.25rem;
	height: 1.25rem;
	padding: 0;
	background: var(--color-surface);
	border: 1.5px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	cursor: pointer;
	transition:
		background 120ms ease,
		border-color 120ms ease;

	&:hover:not(:disabled) {
		border-color: var(--color-on-surface-variant);
	}

	&[data-checked],
	&[data-indeterminate] {
		background: var(--color-primary);
		border-color: var(--color-primary);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const PriIndicator = styled(Checkbox.Indicator).withConfig({
	displayName: 'PriCheckboxIndicator',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--color-on-primary);
	pointer-events: none;
`

export const PriCheckbox = {
	Root: PriRoot,
	Indicator: PriIndicator,
}
