import { PreviewCard } from '@base-ui/react/preview-card'
import styled from 'styled-components'

/**
 * Workshop preview card — an aged-paper file card with a corner paperclip.
 * Used for rich hover previews (e.g. peek a company record from a link).
 */
const PriPopup = styled(PreviewCard.Popup).withConfig({
	displayName: 'PriPreviewCardPopup',
})`
	position: relative;
	width: 22rem;
	max-width: calc(100vw - var(--space-xl));
	padding: var(--space-md) var(--space-lg);
	background:
		radial-gradient(
			ellipse 80px 50px at 20% 30%,
			var(--color-paper-fibre-a) 0%,
			transparent 100%
		),
		var(--color-paper-aged);
	color: var(--color-on-surface);
	border: 1px solid color-mix(in oklab, var(--color-outline) 40%, transparent);
	border-radius: 2px;
	box-shadow:
		0 2px 0 var(--highlight-inset-strong) inset,
		0 6px 18px var(--shadow-color-strong);
	transform-origin: var(--transform-origin);
	transition:
		opacity 200ms ease,
		transform 260ms cubic-bezier(0.22, 1.2, 0.4, 1);

	/* Paperclip corner (CSS-only) */
	&::before {
		content: '';
		position: absolute;
		top: 10px;
		right: 14px;
		width: 14px;
		height: 22px;
		border: 2px solid color-mix(in oklab, var(--color-outline) 85%, transparent);
		border-radius: 6px 6px 0 0;
		border-bottom: none;
		box-shadow: 1px 1px 0 var(--shadow-color-medium);
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: scale(0.96);
	}
`

const PriArrow = styled(PreviewCard.Arrow).withConfig({
	displayName: 'PriPreviewCardArrow',
})`
	width: 10px;
	height: 10px;
	background: var(--color-paper-aged);
	border: 1px solid color-mix(in oklab, var(--color-outline) 40%, transparent);
	border-top: none;
	border-left: none;
	transform: rotate(45deg);
`

export const PriPreviewCard = {
	Root: PreviewCard.Root,
	Trigger: PreviewCard.Trigger,
	Portal: PreviewCard.Portal,
	Positioner: PreviewCard.Positioner,
	Popup: PriPopup,
	Arrow: PriArrow,
}
