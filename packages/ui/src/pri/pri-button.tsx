import { Button } from '@base-ui/react/button'
import styled, { css } from 'styled-components'

/**
 * Neutral button primitive. Three structural variants — all colors come
 * from design tokens only, no gradients or textures. Consumers compose
 * visual skins on top via `styled(PriButton)` and transient props.
 *
 * Usage:
 *   <PriButton $variant="filled">Desa</PriButton>
 *   <PriButton $variant="outlined">Cancel·la</PriButton>
 *   <PriButton $variant="text">Descarta</PriButton>
 */
export type PriButtonVariant = 'filled' | 'outlined' | 'text'

const filled = css`
	background: var(--color-primary);
	color: var(--color-on-primary);
	border-color: transparent;

	&:hover:not(:disabled) {
		background: color-mix(in oklab, var(--color-primary) 90%, black);
	}

	&:active:not(:disabled) {
		background: color-mix(in oklab, var(--color-primary) 80%, black);
	}
`

const outlined = css`
	background: transparent;
	color: var(--color-primary);
	border-color: var(--color-outline);

	&:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
	}

	&:active:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 16%, transparent);
	}
`

const text = css`
	background: transparent;
	color: var(--color-primary);
	border-color: transparent;

	&:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
	}

	&:active:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 16%, transparent);
	}
`

export const PriButton = styled(Button).withConfig({
	displayName: 'PriButton',
	shouldForwardProp: prop => prop !== '$variant',
})<{ $variant?: PriButtonVariant }>`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-md);
	min-height: 2.25rem;
	border: 1px solid transparent;
	border-radius: var(--shape-full);
	font-family: var(--font-body);
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	letter-spacing: var(--typescale-label-large-tracking);
	font-weight: var(--typescale-label-large-weight);
	cursor: pointer;
	transition:
		background 120ms ease,
		color 120ms ease,
		border-color 120ms ease,
		transform 120ms ease;

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	&:active:not(:disabled) {
		transform: translateY(1px);
	}

	${p => {
		switch (p.$variant) {
			case 'outlined':
				return outlined
			case 'text':
				return text
			default:
				return filled
		}
	}}
`
