import { Dialog } from '@base-ui/react/dialog'
import styled from 'styled-components'

/**
 * Workshop dialog — clipboard work order: aged cream paper + cross-hatch
 * desk bg, tape strips top corners, brushed-metal binder clip top-center.
 * Backdrop is warm graphite.
 */
const PriBackdrop = styled(Dialog.Backdrop).withConfig({
	displayName: 'PriDialogBackdrop',
})`
	position: fixed;
	inset: 0;
	background: var(--color-scrim);
	backdrop-filter: blur(2px);
	transition: opacity 240ms ease;

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
	}
`

const PriPopup = styled(Dialog.Popup).withConfig({
	displayName: 'PriDialogPopup',
})`
	position: fixed;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	max-width: min(34rem, calc(100vw - var(--space-xl)));
	width: 100%;
	max-height: calc(100dvh - var(--space-3xl));
	overflow-y: auto;
	background:
		linear-gradient(
			180deg,
			var(--shadow-color-subtle) 0%,
			transparent 24px,
			transparent 100%
		),
		repeating-linear-gradient(
			45deg,
			color-mix(in oklab, var(--color-primary) 3%, transparent) 0 1px,
			transparent 1px 12px
		),
		repeating-linear-gradient(
			-45deg,
			color-mix(in oklab, var(--color-secondary) 3%, transparent) 0 1px,
			transparent 1px 12px
		),
		var(--color-paper-aged);
	color: var(--color-on-surface);
	border: 1px solid color-mix(in oklab, var(--color-outline) 50%, transparent);
	border-radius: 2px;
	padding: calc(var(--space-2xl) + 0.25rem) var(--space-xl) var(--space-xl);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	box-shadow:
		0 2px 0 var(--highlight-inset-strong) inset,
		0 6px 18px var(--shadow-color-deep),
		0 24px 60px var(--shadow-color-deep);
	transform-origin: top center;
	transition:
		transform 260ms cubic-bezier(0.22, 1.2, 0.4, 1),
		opacity 200ms ease;

	&::before {
		content: '';
		position: absolute;
		top: -10px;
		left: 50%;
		transform: translateX(-50%);
		width: 64px;
		height: 22px;
		background: linear-gradient(
			145deg,
			var(--color-metal-light) 0%,
			var(--color-metal) 50%,
			var(--color-metal-dark) 100%
		);
		border: 1px solid var(--color-metal-edge);
		border-radius: 3px;
		box-shadow:
			inset 0 1px 0 var(--highlight-inset-bright),
			0 2px 4px var(--shadow-color-deep);
	}

	&::after {
		content: '';
		position: absolute;
		top: -1px;
		left: 50%;
		transform: translateX(-50%);
		width: 18px;
		height: 8px;
		background: var(--color-metal-deep);
		border-radius: 0 0 3px 3px;
		box-shadow: inset 0 -1px 0 var(--shadow-color-deep);
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: translate(-50%, calc(-50% - 18px)) rotate(-0.6deg);
	}
`

const PriTitle = styled(Dialog.Title).withConfig({
	displayName: 'PriDialogTitle',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	margin: 0;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	text-shadow: var(--text-shadow-emboss);
`

const PriDescription = styled(Dialog.Description).withConfig({
	displayName: 'PriDialogDescription',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	letter-spacing: var(--typescale-body-medium-tracking);
	color: var(--color-on-surface-variant);
	margin: 0;
	font-style: italic;
`

export const PriDialog = {
	Root: Dialog.Root,
	Trigger: Dialog.Trigger,
	Portal: Dialog.Portal,
	Close: Dialog.Close,
	Viewport: Dialog.Viewport,
	Backdrop: PriBackdrop,
	Popup: PriPopup,
	Title: PriTitle,
	Description: PriDescription,
}
