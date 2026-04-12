import { NumberField } from '@base-ui/react/number-field'
import styled from 'styled-components'

/**
 * Workshop number field — ledger input flanked by tiny stamped-metal
 * increment/decrement buttons with embossed +/− glyphs.
 *
 *   <PriNumberField.Root min={0}>
 *     <PriNumberField.Group>
 *       <PriNumberField.Decrement>−</PriNumberField.Decrement>
 *       <PriNumberField.Input />
 *       <PriNumberField.Increment>+</PriNumberField.Increment>
 *     </PriNumberField.Group>
 *   </PriNumberField.Root>
 */
const PriGroup = styled(NumberField.Group).withConfig({
	displayName: 'PriNumberFieldGroup',
})`
	display: inline-flex;
	align-items: stretch;
	border-bottom: 2px solid var(--color-outline);
	background: #f0e8d0;
	box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);

	&:focus-within {
		border-bottom-color: var(--color-primary);
	}
`

const PriInput = styled(NumberField.Input).withConfig({
	displayName: 'PriNumberFieldInput',
})`
	flex: 1;
	min-width: 3rem;
	padding: var(--space-xs) var(--space-sm);
	background: transparent;
	border: none;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface);
	text-align: center;
	outline: none;

	&::placeholder {
		color: var(--color-on-surface-variant);
		opacity: 0.7;
		font-style: italic;
	}
`

const stepperCss = `
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.3);
	border-radius: 0;
	color: var(--color-on-surface);
	font-family: var(--font-display);
	font-size: var(--typescale-title-medium-size);
	font-weight: var(--font-weight-bold);
	text-shadow: var(--text-shadow-emboss);
	cursor: pointer;
	transition: background 120ms ease;

	&:hover:not(:disabled) {
		background: linear-gradient(
			145deg,
			var(--color-metal-light) 0%,
			var(--color-metal-light) 50%,
			var(--color-metal) 100%
		);
	}

	&:active:not(:disabled) {
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const PriIncrement = styled(NumberField.Increment).withConfig({
	displayName: 'PriNumberFieldIncrement',
})`
	${stepperCss}
`

const PriDecrement = styled(NumberField.Decrement).withConfig({
	displayName: 'PriNumberFieldDecrement',
})`
	${stepperCss}
`

export const PriNumberField = {
	Root: NumberField.Root,
	Group: PriGroup,
	Input: PriInput,
	Increment: PriIncrement,
	Decrement: PriDecrement,
	ScrubArea: NumberField.ScrubArea,
	ScrubAreaCursor: NumberField.ScrubAreaCursor,
}
