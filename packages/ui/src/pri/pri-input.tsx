import { Input } from '@base-ui/react/input'
import styled from 'styled-components'

/**
 * Neutral single-line input. Pairs naturally with a BaseUI Field
 * (Field.Root + Field.Label + Field.Error) when label/error semantics
 * are needed — consumers wire that at the call site so this primitive
 * stays focused on the visible box.
 */
export const PriInput = styled(Input).withConfig({
	displayName: 'PriInput',
})`
	width: 100%;
	padding: var(--space-xs) var(--space-sm);
	background: var(--color-surface);
	color: var(--color-on-surface);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	transition:
		border-color 120ms ease,
		box-shadow 120ms ease;

	&::placeholder {
		color: var(--color-on-surface-variant);
		opacity: 0.7;
	}

	&:hover:not(:disabled) {
		border-color: var(--color-on-surface-variant);
	}

	&:focus,
	&:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px
			color-mix(in srgb, var(--color-primary) 24%, transparent);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--color-surface-container);
	}

	&[data-invalid] {
		border-color: var(--color-error);
	}
`
