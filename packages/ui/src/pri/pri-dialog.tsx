import { Dialog } from '@base-ui/react/dialog'
import styled from 'styled-components'

/**
 * Neutral dialog primitive following Base UI's compound namespace.
 * Structural parts (Root, Trigger, Portal, Close, Viewport) are re-
 * exported as-is; visually significant parts (Backdrop, Popup, Title,
 * Description) come pre-styled with design tokens.
 *
 * Consumers typically render:
 *   <PriDialog.Root open={open} onOpenChange={setOpen}>
 *     <PriDialog.Portal>
 *       <PriDialog.Backdrop />
 *       <PriDialog.Popup>
 *         <PriDialog.Title>...</PriDialog.Title>
 *         <PriDialog.Description>...</PriDialog.Description>
 *         {children}
 *         <PriDialog.Close>Tanca</PriDialog.Close>
 *       </PriDialog.Popup>
 *     </PriDialog.Portal>
 *   </PriDialog.Root>
 */
const PriBackdrop = styled(Dialog.Backdrop).withConfig({
	displayName: 'PriDialogBackdrop',
})`
	position: fixed;
	inset: 0;
	background: color-mix(in srgb, var(--color-on-surface) 40%, transparent);
	backdrop-filter: blur(2px);
	transition: opacity 200ms ease;

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
	max-width: min(32rem, calc(100vw - var(--space-xl)));
	width: 100%;
	max-height: calc(100dvh - var(--space-2xl));
	overflow-y: auto;
	background: var(--color-surface);
	color: var(--color-on-surface);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-md);
	padding: var(--space-xl);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	box-shadow:
		0 4px 12px rgba(0, 0, 0, 0.08),
		0 16px 40px rgba(0, 0, 0, 0.12);
	transform-origin: center;
	transition:
		transform 200ms ease,
		opacity 200ms ease;

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: translate(-50%, -50%) scale(0.96);
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
