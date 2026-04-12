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
	background: color-mix(in oklab, #1a1612 70%, transparent);
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
			rgba(0, 0, 0, 0.04) 0%,
			transparent 24px,
			transparent 100%
		),
		repeating-linear-gradient(
			45deg,
			rgba(176, 82, 32, 0.03) 0 1px,
			transparent 1px 12px
		),
		repeating-linear-gradient(
			-45deg,
			rgba(46, 107, 79, 0.03) 0 1px,
			transparent 1px 12px
		),
		#f0e8d0;
	color: var(--color-on-surface);
	border: 1px solid rgba(132, 125, 113, 0.5);
	border-radius: 2px;
	padding: calc(var(--space-2xl) + 0.25rem) var(--space-xl) var(--space-xl);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	box-shadow:
		0 2px 0 rgba(255, 255, 255, 0.35) inset,
		0 6px 18px rgba(0, 0, 0, 0.25),
		0 24px 60px rgba(0, 0, 0, 0.3);
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
		border: 1px solid rgba(0, 0, 0, 0.35);
		border-radius: 3px;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.5),
			0 2px 4px rgba(0, 0, 0, 0.25);
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
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.3);
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
