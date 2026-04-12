import { Tooltip } from '@base-ui/react/tooltip'
import styled from 'styled-components'

/**
 * Workshop tooltip — a stamped metal tag with a micro-rotation and an
 * embossed uppercase label. Looks like a hand-punched shop tag hanging
 * from a nail.
 *
 *   <PriTooltip.Provider delay={200}>
 *     <PriTooltip.Root>
 *       <PriTooltip.Trigger render={<button />}>…</PriTooltip.Trigger>
 *       <PriTooltip.Portal>
 *         <PriTooltip.Positioner>
 *           <PriTooltip.Popup>Label</PriTooltip.Popup>
 *         </PriTooltip.Positioner>
 *       </PriTooltip.Portal>
 *     </PriTooltip.Root>
 *   </PriTooltip.Provider>
 */
const PriPopup = styled(Tooltip.Popup).withConfig({
	displayName: 'PriTooltipPopup',
})`
	position: relative;
	padding: 0.375rem 0.625rem;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	color: var(--color-on-surface);
	border: 1px solid rgba(0, 0, 0, 0.35);
	border-radius: 2px;
	box-shadow: var(--elevation-workshop-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
	transform: rotate(-1deg);
	transition:
		opacity 160ms ease,
		transform 200ms cubic-bezier(0.22, 1.2, 0.4, 1);

	&::before {
		content: '';
		position: absolute;
		top: 4px;
		left: 50%;
		transform: translateX(-50%);
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: radial-gradient(circle, #1a1612 40%, transparent 70%);
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: rotate(-1deg) translateY(-4px);
	}
`

const PriArrow = styled(Tooltip.Arrow).withConfig({
	displayName: 'PriTooltipArrow',
})`
	width: 8px;
	height: 8px;
	background: var(--color-metal);
	border: 1px solid rgba(0, 0, 0, 0.35);
	border-top: none;
	border-left: none;
	transform: rotate(45deg);
`

export const PriTooltip = {
	Provider: Tooltip.Provider,
	Root: Tooltip.Root,
	Trigger: Tooltip.Trigger,
	Portal: Tooltip.Portal,
	Positioner: Tooltip.Positioner,
	Popup: PriPopup,
	Arrow: PriArrow,
}
