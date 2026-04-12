import { Collapsible } from '@base-ui/react/collapsible'
import styled from 'styled-components'

/**
 * Workshop collapsible — the trigger looks like a strip of masking tape
 * across the section. Click to expand; panel animates open via height.
 *
 *   <PriCollapsible.Root>
 *     <PriCollapsible.Trigger>Timeline</PriCollapsible.Trigger>
 *     <PriCollapsible.Panel>…</PriCollapsible.Panel>
 *   </PriCollapsible.Root>
 */
const PriTrigger = styled(Collapsible.Trigger).withConfig({
	displayName: 'PriCollapsibleTrigger',
})`
	position: relative;
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-xs) var(--space-lg);
	background: linear-gradient(
		180deg,
		rgba(244, 232, 196, 0.92) 0%,
		rgba(226, 210, 166, 0.92) 100%
	);
	color: var(--color-on-surface);
	border: 1px solid rgba(0, 0, 0, 0.08);
	border-radius: 0;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
	font-family: var(--font-display);
	font-size: var(--typescale-title-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
	cursor: pointer;
	transform: rotate(-1.5deg);
	transform-origin: left center;
	transition:
		transform 200ms ease,
		box-shadow 200ms ease;

	&:hover {
		transform: rotate(-1deg) translateY(-1px);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	& svg {
		transition: transform 200ms ease;
	}

	&[data-panel-open] svg {
		transform: rotate(90deg);
	}
`

const PriPanel = styled(Collapsible.Panel).withConfig({
	displayName: 'PriCollapsiblePanel',
})`
	overflow: hidden;
	transition: height 260ms cubic-bezier(0.22, 1.2, 0.4, 1);

	&[data-starting-style],
	&[data-ending-style] {
		height: 0;
	}

	&[data-open] {
		height: var(--collapsible-panel-height);
	}
`

export const PriCollapsible = {
	Root: Collapsible.Root,
	Trigger: PriTrigger,
	Panel: PriPanel,
}
