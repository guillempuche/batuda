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
		var(--color-tape-light) 0%,
		var(--color-tape) 100%
	);
	color: var(--color-on-surface);
	border: 1px solid var(--color-metal-edge-soft);
	border-radius: 0;
	box-shadow: 0 1px 3px var(--shadow-color);
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
		box-shadow: 0 2px 6px var(--shadow-color-strong);
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

// A folded panel keeps its text on the page instead of throwing it away, so
// the browser's own Find reaches it and opens the section on a match. On by
// default so sections written later get it too; pass `hiddenUntilFound={false}`
// where content should not linger. Reading the prop here, rather than fixing
// the value, is what leaves that choice to the caller.
//
// It rests on Tailwind's reset sparing `hidden='until-found'` from
// `display: none`. If that exception ever goes, a folded section stays
// invisible for good rather than merely unfindable.
const PriPanel = styled(Collapsible.Panel)
	.attrs<{
		readonly hiddenUntilFound?: boolean
	}>(props => ({ hiddenUntilFound: props.hiddenUntilFound ?? true }))
	.withConfig({
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
