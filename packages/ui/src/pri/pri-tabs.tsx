import { Tabs } from '@base-ui/react/tabs'
import type { ComponentProps } from 'react'
import styled from 'styled-components'

/**
 * Workshop tabs rendered as file-folder tabs. Each tab is an aged-paper
 * folder with a slanted leading edge (via clip-path); the selected tab
 * lifts forward with a subtle metal elevation and an amber under-rule.
 *
 * Usage:
 *   <PriTabs.Root defaultValue="profile">
 *     <PriTabs.List>
 *       <PriTabs.Tab value="profile">Perfil</PriTabs.Tab>
 *       <PriTabs.Tab value="contacts">Contactes</PriTabs.Tab>
 *       <PriTabs.Indicator />
 *     </PriTabs.List>
 *     <PriTabs.Panel value="profile">...</PriTabs.Panel>
 *   </PriTabs.Root>
 */
const PriList = styled(Tabs.List).withConfig({
	displayName: 'PriTabsList',
})`
	position: relative;
	display: flex;
	flex-wrap: nowrap;
	gap: 2px;
	padding: 0 var(--space-sm);
	border-bottom: 2px solid rgba(0, 0, 0, 0.18);
	background: transparent;
	overflow-x: auto;
	overflow-y: hidden;
	scrollbar-width: thin;
	scroll-snap-type: x proximity;
	/* Fade the leading + trailing pixels so it's visible that the tab
	 * strip can scroll horizontally when there isn't room for every tab.
	 * mask-image works on the rendered element (including the children),
	 * so scroll-snapped tabs stay fully readable in the centre while the
	 * edges hint "more here". */
	mask-image: linear-gradient(
		to right,
		transparent 0,
		black 1.25rem,
		black calc(100% - 1.25rem),
		transparent 100%
	);

	&::-webkit-scrollbar {
		height: 4px;
	}
	&::-webkit-scrollbar-thumb {
		background: color-mix(in oklab, var(--color-on-surface) 25%, transparent);
		border-radius: 4px;
	}
`

const PriTab = styled(Tabs.Tab).withConfig({
	displayName: 'PriTabsTab',
})`
	position: relative;
	flex-shrink: 0;
	scroll-snap-align: start;
	background: #e7dec4;
	border: none;
	padding: var(--space-sm) var(--space-lg) var(--space-xs);
	margin-bottom: -2px;
	min-height: 2.5rem;
	white-space: nowrap;
	clip-path: polygon(
		12px 0,
		calc(100% - 12px) 0,
		100% 100%,
		0 100%
	);
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	letter-spacing: 0.06em;
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	cursor: pointer;
	box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.12);
	transition:
		color 160ms ease,
		background 160ms ease,
		transform 160ms ease;

	&:hover {
		color: var(--color-on-surface);
		background: #ede3c8;
	}

	&[data-selected] {
		background: #f0e8d0;
		color: var(--color-on-surface);
		text-shadow: var(--text-shadow-emboss);
		transform: translateY(-1px);
		box-shadow: inset 0 -2px 0 var(--color-primary);
		z-index: 1;
	}

	&:focus-visible {
		outline: none;
		box-shadow:
			inset 0 -2px 0 var(--color-primary),
			var(--glow-active);
	}
`

const PriIndicator = styled(Tabs.Indicator).withConfig({
	displayName: 'PriTabsIndicator',
})`
	position: absolute;
	bottom: 0;
	left: 0;
	height: 2px;
	width: var(--active-tab-width);
	transform: translateX(var(--active-tab-left));
	background: var(--color-primary);
	transition:
		transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
		width 220ms cubic-bezier(0.4, 0, 0.2, 1);
`

type PriTabProps = ComponentProps<typeof PriTab> & {
	'data-testid'?: string
}

function PriTabWithTestId({
	value,
	'data-testid': testId,
	...rest
}: PriTabProps) {
	const derived =
		typeof value === 'string' && value.length > 0 ? `tab-${value}` : undefined
	return <PriTab value={value} data-testid={testId ?? derived} {...rest} />
}

export const PriTabs = {
	Root: Tabs.Root,
	Panel: Tabs.Panel,
	List: PriList,
	Tab: PriTabWithTestId,
	Indicator: PriIndicator,
}
