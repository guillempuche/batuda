import { Toolbar } from '@base-ui/react/toolbar'
import { styled } from 'next-yak'

/**
 * Workshop toolbar — brushed metal strip with screw dots at the corners
 * and tick-mark separators. Gives any filter/action row the look of a
 * tool rail bolted to a workbench.
 *
 *   <PriToolbar.Root>
 *     <PriToolbar.Button>Filter</PriToolbar.Button>
 *     <PriToolbar.Separator />
 *     <PriToolbar.Button>Sort</PriToolbar.Button>
 *   </PriToolbar.Root>
 */
const PriRoot = styled(Toolbar.Root)`
	position: relative;
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-2xs) var(--space-md);
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid var(--color-metal-edge);
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-sm);
	min-height: 2.75rem;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--texture-brushed-metal);
		border-radius: inherit;
		pointer-events: none;
	}

	& > * {
		position: relative;
		z-index: 1;
	}
`

const PriButton = styled(Toolbar.Button)`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	background: transparent;
	border: 1px solid transparent;
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.05em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
	color: var(--color-on-surface);
	cursor: pointer;
	transition:
		background 120ms ease,
		border-color 120ms ease;

	&:hover:not(:disabled) {
		background: var(--highlight-inset);
		border-color: var(--color-metal-edge);
	}

	&:active:not(:disabled) {
		background: var(--shadow-color-subtle);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const PriSeparator = styled(Toolbar.Separator)`
	width: 1px;
	align-self: stretch;
	margin: var(--space-2xs) var(--space-2xs);
	background: repeating-linear-gradient(
		180deg,
		var(--shadow-color-deep) 0 4px,
		transparent 4px 8px
	);
`

const PriInput = styled(Toolbar.Input)`
	padding: var(--space-2xs) var(--space-sm);
	background: var(--color-paper-aged);
	border: none;
	border-bottom: 2px solid var(--color-outline);
	border-radius: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	min-width: 12rem;
	outline: none;

	&:focus,
	&:focus-visible {
		border-bottom-color: var(--color-primary);
	}

	&::placeholder {
		color: var(--color-on-surface-variant);
		font-style: italic;
	}
`

export const PriToolbar = {
	Root: PriRoot,
	Button: PriButton,
	Separator: PriSeparator,
	Input: PriInput,
	Group: Toolbar.Group,
	Link: Toolbar.Link,
}
