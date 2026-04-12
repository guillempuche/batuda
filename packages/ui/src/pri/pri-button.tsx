import { Button } from '@base-ui/react/button'
import styled, { css } from 'styled-components'

/**
 * Workshop button primitive. Three variants:
 *   - filled:   stamped-metal plate (brushed gradient + engraved label)
 *   - outlined: stencil (dashed outline, uppercase, no fill)
 *   - text:     underlined display-font link
 *
 * Usage:
 *   <PriButton $variant="filled">Desa</PriButton>
 *   <PriButton $variant="outlined">Cancel·la</PriButton>
 *   <PriButton $variant="text">Descarta</PriButton>
 */
export type PriButtonVariant = 'filled' | 'outlined' | 'text'

const filled = css`
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	color: var(--color-on-surface);
	border-color: rgba(0, 0, 0, 0.25);
	box-shadow: var(--elevation-workshop-md);
	text-shadow: var(--text-shadow-emboss);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	font-weight: var(--font-weight-bold);

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--texture-brushed-metal);
		pointer-events: none;
		border-radius: inherit;
	}

	&:hover:not(:disabled) {
		background: linear-gradient(
			145deg,
			var(--color-metal-light) 0%,
			var(--color-metal-light) 50%,
			var(--color-metal) 100%
		);
	}

	&:active:not(:disabled) {
		box-shadow: var(--elevation-workshop-sm);
		text-shadow: var(--text-shadow-engrave);
	}
`

const outlined = css`
	background: transparent;
	color: var(--color-on-surface);
	border: 2px dashed var(--color-outline);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	font-weight: var(--font-weight-bold);

	&:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	&:active:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 16%, transparent);
	}
`

const text = css`
	background: transparent;
	color: var(--color-primary);
	border-color: transparent;
	font-family: var(--font-display);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	padding-inline: var(--space-2xs);

	&:hover:not(:disabled) {
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 2px;
	}

	&:active:not(:disabled) {
		color: color-mix(in oklab, var(--color-primary) 80%, black);
	}
`

export const PriButton = styled(Button).withConfig({
	displayName: 'PriButton',
	shouldForwardProp: prop => prop !== '$variant',
})<{ $variant?: PriButtonVariant }>`
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-md);
	min-height: 2.25rem;
	border: 1px solid transparent;
	border-radius: var(--shape-2xs);
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
		box-shadow 120ms ease,
		transform 120ms ease;

	& > * {
		position: relative;
		z-index: 1;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
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
