import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import styled, { css } from 'styled-components'

/**
 * Workshop toggle group — stencil-outline buttons that flip to
 * stamped-metal (terracotta fill + engraved label) when pressed.
 *
 *   <PriToggleGroup.Root value={channel} onValueChange={setChannel}>
 *     <PriToggleGroup.Item value="email">Email</PriToggleGroup.Item>
 *     <PriToggleGroup.Item value="phone">Phone</PriToggleGroup.Item>
 *   </PriToggleGroup.Root>
 */

const baseToggle = css`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-md);
	min-height: 2.25rem;
	background: transparent;
	color: var(--color-on-surface);
	border: 2px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
	transition:
		background 160ms ease,
		color 160ms ease,
		border-color 160ms ease,
		box-shadow 160ms ease,
		transform 160ms ease;

	&:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 6%, transparent);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	&[data-pressed] {
		background: var(--color-primary);
		color: var(--color-on-primary);
		border-style: solid;
		border-color: color-mix(in oklab, var(--color-primary) 70%, black);
		text-shadow: var(--text-shadow-engrave);
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.25),
			0 1px 0 rgba(255, 255, 255, 0.15);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const PriRoot = styled(ToggleGroup).withConfig({
	displayName: 'PriToggleGroupRoot',
})`
	display: inline-flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const PriItem = styled(Toggle).withConfig({
	displayName: 'PriToggleGroupItem',
})`
	${baseToggle}
`

export const PriToggleGroup = {
	Root: PriRoot,
	Item: PriItem,
}

export const PriToggle = PriItem
