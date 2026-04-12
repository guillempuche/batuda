import { Input } from '@base-ui/react/input'
import styled from 'styled-components'

/**
 * Aged-paper ledger input. No border-radius, cream fill, thick bottom rule
 * that darkens to terracotta on focus (drafting pencil on paper). Pairs with
 * PriField for label/error semantics.
 */
export const PriInput = styled(Input).withConfig({
	displayName: 'PriInput',
})`
	width: 100%;
	padding: var(--space-xs) var(--space-sm);
	background: #f0e8d0;
	color: var(--color-on-surface);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	border-radius: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
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
		background: #f5ecd6;
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.06),
			0 2px 0 -1px color-mix(in srgb, var(--color-primary) 40%, transparent);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--color-surface-container);
	}

	&[data-invalid] {
		border-bottom-color: var(--color-error);
	}
`
