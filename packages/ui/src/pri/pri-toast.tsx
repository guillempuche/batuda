import { Toast } from '@base-ui/react/toast'
import styled from 'styled-components'

/**
 * Workshop toast — clipboard note: aged paper card with a masking tape
 * corner + a binder clip up top. Slides in from the bottom-right.
 *
 * Mount `<PriToast.Provider>` high in the tree and one `<PriToast.Viewport>`
 * somewhere at app chrome. Fire toasts via `useToastManager()` from Base UI.
 */
const PriViewport = styled(Toast.Viewport).withConfig({
	displayName: 'PriToastViewport',
})`
	position: fixed;
	bottom: var(--space-lg);
	right: var(--space-lg);
	width: min(22rem, calc(100vw - var(--space-xl)));
	z-index: 9999;
	display: flex;
	flex-direction: column-reverse;
	gap: var(--space-xs);
	pointer-events: none;
`

const PriRoot = styled(Toast.Root).withConfig({
	displayName: 'PriToastRoot',
})`
	position: relative;
	pointer-events: auto;
	padding: var(--space-sm) var(--space-md);
	padding-top: calc(var(--space-md) + 4px);
	background:
		radial-gradient(
			ellipse 60px 40px at 18% 32%,
			rgba(180, 155, 120, 0.08) 0%,
			transparent 100%
		),
		#f0e8d0;
	color: var(--color-on-surface);
	border: 1px solid rgba(132, 125, 113, 0.4);
	border-radius: 2px;
	box-shadow:
		0 2px 0 rgba(255, 255, 255, 0.35) inset,
		0 4px 12px rgba(0, 0, 0, 0.2);
	display: flex;
	flex-direction: column;
	gap: 2px;
	transition: opacity 200ms ease;

	&[data-type='success'] {
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--color-secondary) 40%, transparent),
			0 2px 0 rgba(255, 255, 255, 0.35) inset,
			0 4px 12px rgba(0, 0, 0, 0.2);
	}

	&[data-type='error'] {
		border-left: 4px solid var(--color-error);
	}

	/* Masking-tape strip at top-left */
	&::before {
		content: '';
		position: absolute;
		top: -6px;
		left: -8px;
		width: 58px;
		height: 18px;
		background: linear-gradient(
			180deg,
			rgba(244, 232, 196, 0.88) 0%,
			rgba(226, 210, 166, 0.85) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.08);
		transform: rotate(-4deg);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
		pointer-events: none;
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
	}
`

const PriTitle = styled(Toast.Title).withConfig({
	displayName: 'PriToastTitle',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.05em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
	margin: 0;
`

const PriDescription = styled(Toast.Description).withConfig({
	displayName: 'PriToastDescription',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	font-style: italic;
	margin: 0;
`

const PriClose = styled(Toast.Close).withConfig({
	displayName: 'PriToastClose',
})`
	position: absolute;
	top: 4px;
	right: 6px;
	padding: 2px 6px;
	background: transparent;
	border: none;
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		color: var(--color-on-surface);
	}
`

export const PriToast: {
	Provider: typeof Toast.Provider
	Portal: typeof Toast.Portal
	Positioner: typeof Toast.Positioner
	Viewport: typeof PriViewport
	Root: typeof PriRoot
	Title: typeof PriTitle
	Description: typeof PriDescription
	Close: typeof PriClose
} = {
	Provider: Toast.Provider,
	Portal: Toast.Portal,
	Positioner: Toast.Positioner,
	Viewport: PriViewport,
	Root: PriRoot,
	Title: PriTitle,
	Description: PriDescription,
	Close: PriClose,
}

export const usePriToast = Toast.useToastManager
export const createPriToastManager = Toast.createToastManager
