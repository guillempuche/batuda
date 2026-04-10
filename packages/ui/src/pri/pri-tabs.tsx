import { Tabs } from '@base-ui/react/tabs'
import styled from 'styled-components'

/**
 * Neutral tabs primitive following Base UI's compound namespace.
 * Structural parts (Root, Panel) are re-exported as-is; visually
 * significant parts (List, Tab, Indicator) come pre-styled with
 * design tokens.
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
	gap: var(--space-xs);
	border-bottom: 1px solid var(--color-outline-variant);
	padding: 0 var(--space-2xs);
`

const PriTab = styled(Tabs.Tab).withConfig({
	displayName: 'PriTabsTab',
})`
	position: relative;
	background: transparent;
	border: none;
	padding: var(--space-sm) var(--space-md);
	font-family: var(--font-body);
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	letter-spacing: var(--typescale-label-large-tracking);
	font-weight: var(--typescale-label-large-weight);
	color: var(--color-on-surface-variant);
	cursor: pointer;
	transition: color 120ms ease;

	&:hover {
		color: var(--color-on-surface);
	}

	&[data-selected] {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-radius: var(--shape-xs);
	}
`

const PriIndicator = styled(Tabs.Indicator).withConfig({
	displayName: 'PriTabsIndicator',
})`
	position: absolute;
	bottom: -1px;
	left: 0;
	height: 2px;
	width: var(--active-tab-width);
	transform: translateX(var(--active-tab-left));
	background: var(--color-primary);
	border-radius: var(--shape-full);
	transition:
		transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
		width 200ms cubic-bezier(0.4, 0, 0.2, 1);
`

export const PriTabs = {
	Root: Tabs.Root,
	Panel: Tabs.Panel,
	List: PriList,
	Tab: PriTab,
	Indicator: PriIndicator,
}
