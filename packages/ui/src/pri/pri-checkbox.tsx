import { Checkbox } from '@base-ui/react/checkbox'
import styled from 'styled-components'

/**
 * Workshop checkbox — metal bezel with a terracotta dome cap when checked.
 * Usage:
 *   <PriCheckbox.Root checked={done} onCheckedChange={setDone}>
 *     <PriCheckbox.Indicator>
 *       <Check size={12} />
 *     </PriCheckbox.Indicator>
 *   </PriCheckbox.Root>
 */
const PriRoot = styled(Checkbox.Root).withConfig({
	displayName: 'PriCheckboxRoot',
})`
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.25rem;
	height: 1.25rem;
	padding: 0;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.3);
	border-radius: 50%;
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.45),
		0 1px 2px rgba(0, 0, 0, 0.2);
	cursor: pointer;
	transition:
		background 160ms ease,
		border-color 160ms ease,
		box-shadow 200ms ease;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--texture-brushed-metal);
		pointer-events: none;
	}

	&:hover:not(:disabled) {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.55),
			0 2px 3px rgba(0, 0, 0, 0.25);
	}

	&[data-checked],
	&[data-indeterminate] {
		background: radial-gradient(
			circle at 35% 30%,
			color-mix(in oklab, var(--color-primary) 88%, white) 0%,
			var(--color-primary) 55%,
			color-mix(in oklab, var(--color-primary) 70%, black) 100%
		);
		border-color: color-mix(in oklab, var(--color-primary) 60%, black);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	&:focus-visible {
		outline: none;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.45),
			var(--glow-active);
	}
`

const PriIndicator = styled(Checkbox.Indicator).withConfig({
	displayName: 'PriCheckboxIndicator',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--color-on-primary);
	pointer-events: none;
	position: relative;
	z-index: 1;
	filter: drop-shadow(0 -1px 0 rgba(0, 0, 0, 0.25));
`

export const PriCheckbox = {
	Root: PriRoot,
	Indicator: PriIndicator,
}
