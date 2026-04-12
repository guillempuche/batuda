import { Field } from '@base-ui/react/field'
import styled from 'styled-components'

/**
 * Workshop field — stenciled uppercase label, italic description,
 * terracotta left-rule error text.
 *
 *   <PriField.Root>
 *     <PriField.Label>Company</PriField.Label>
 *     <PriInput />
 *     <PriField.Description>Pick one from the list</PriField.Description>
 *     <PriField.Error />
 *   </PriField.Root>
 */
const PriRoot = styled(Field.Root).withConfig({
	displayName: 'PriFieldRoot',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 0;
`

const PriLabel = styled(Field.Label).withConfig({
	displayName: 'PriFieldLabel',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const PriDescription = styled(Field.Description).withConfig({
	displayName: 'PriFieldDescription',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const PriError = styled(Field.Error).withConfig({
	displayName: 'PriFieldError',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	color: var(--color-error);
	padding-left: var(--space-xs);
	border-left: 3px solid var(--color-error);
`

export const PriField = {
	Root: PriRoot,
	Label: PriLabel,
	Description: PriDescription,
	Error: PriError,
	Validity: Field.Validity,
	Control: Field.Control,
}
