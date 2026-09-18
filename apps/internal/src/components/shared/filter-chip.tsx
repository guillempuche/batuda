import { styled } from 'next-yak'

/**
 * One value of a filter that is switched on and off by pressing it — a stage on
 * the companies list, a status or a yes/no on the emails list.
 *
 * Whether it is on is read straight off `aria-pressed`, the attribute that
 * already has to be there for anyone listening. A second prop saying the same
 * thing is a second thing to keep in step, and the one that gets forgotten is
 * always the spoken one: the strip then reads as a row of plain buttons with no
 * way to tell which is in force.
 *
 * Every chip is a real toggle, `aria-pressed` included — the "all" chip too,
 * which lights up while carrying no filter of its own.
 */
export const FilterChip = styled.button`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	background: transparent;
	color: var(--color-on-surface);
	border: 2px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
	transition:
		background 160ms ease,
		color 160ms ease,
		border-color 160ms ease;

	&[aria-pressed='true'] {
		background: var(--color-primary);
		color: var(--color-on-primary);
		border-style: solid;
		border-color: color-mix(in oklab, var(--color-primary) 70%, black);
		text-shadow: var(--text-shadow-engrave);
		box-shadow:
			inset 0 1px 3px var(--shadow-color-deep),
			0 1px 0 var(--highlight-inset-soft);
	}

	&:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`
