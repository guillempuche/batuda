import { Switch } from '@base-ui/react/switch'
import { styled } from 'next-yak'

/**
 * Workshop switch — a machined slot with a domed cap that slides along it.
 *
 * Reach for this rather than PriCheckbox when flicking it changes what is on
 * screen straight away; a checkbox says "include this when I submit", a switch
 * says "this is on now". Screen readers are told the difference.
 *
 *   <label>
 *     <PriSwitch.Root checked={showAll} onCheckedChange={setShowAll}>
 *       <PriSwitch.Thumb />
 *     </PriSwitch.Root>
 *     Show system events
 *   </label>
 *
 * Base UI gives the control no name of its own, so it has to sit inside a
 * label or be pointed at one.
 */
const PriRoot = styled(Switch.Root)`
	position: relative;
	display: inline-flex;
	align-items: center;
	flex-shrink: 0;
	width: 2.25rem;
	height: 1.25rem;
	padding: 2px;
	background: linear-gradient(
		145deg,
		var(--color-metal-dark) 0%,
		var(--color-metal) 55%,
		var(--color-metal-light) 100%
	);
	border: 1px solid var(--color-metal-edge);
	border-radius: var(--shape-full);
	box-shadow:
		inset 0 1px 3px var(--shadow-color-deep),
		0 1px 0 var(--highlight-inset-soft);
	cursor: pointer;
	transition:
		background 160ms ease,
		border-color 160ms ease;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--texture-brushed-metal);
		pointer-events: none;
	}

	&[data-checked] {
		background: linear-gradient(
			145deg,
			color-mix(in oklab, var(--color-primary) 70%, black) 0%,
			var(--color-primary) 100%
		);
		border-color: color-mix(in oklab, var(--color-primary) 60%, black);
	}

	&[data-disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const PriThumb = styled(Switch.Thumb)`
	position: relative;
	z-index: 1;
	width: 1rem;
	height: 1rem;
	border-radius: 50%;
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, var(--color-metal-light) 92%, white) 0%,
		var(--color-metal-light) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid var(--color-metal-edge);
	box-shadow:
		inset 0 1px 0 var(--highlight-inset-bright),
		0 1px 2px var(--shadow-color-strong);
	transition: transform 200ms ease;

	&[data-checked] {
		transform: translateX(1rem);
	}
`

export const PriSwitch = {
	Root: PriRoot,
	Thumb: PriThumb,
}
