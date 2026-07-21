import { useLingui } from '@lingui/react/macro'
import styled from 'styled-components'

import { MachineButton } from './machine-button'
import { NavGroupKnob } from './nav-group-knob'
import { navGroups } from './nav-items'
import { NavLink } from './nav-link'

/**
 * Mobile fixed bottom navigation — a dark-leather tool belt with stitched
 * dividers, each slot holding a compact MachineButton knob (same
 * component the desktop SideNav uses at `size='full'`). Visible at
 * <1024px; above that the desktop SideNav takes over and this bar
 * hides. Active tab lights the amber focus ring on the housing.
 *
 * The belt shows the four `navGroups` slots rather than every section: a
 * one-member slot is a direct link, a many-member slot is a popover knob.
 * This keeps the belt from overflowing as sections are added — the desktop
 * rack still lists them all.
 */
export function BottomNav() {
	const { t, i18n } = useLingui()
	return (
		<Bar role='navigation' aria-label={t`Primary navigation`}>
			{navGroups.map(group => {
				const [only] = group.items
				if (group.items.length === 1 && only !== undefined) {
					const item = only
					const Icon = item.icon
					const label = i18n._(item.label)
					return (
						<NavLink
							key={group.testId}
							to={item.path}
							exact={item.exact}
							aria-label={label}
							data-testid={`nav-${item.testId}`}
						>
							{({ isActive }) => (
								<MachineButton
									icon={Icon}
									label={label}
									color={item.color}
									active={isActive}
									size='compact'
								/>
							)}
						</NavLink>
					)
				}
				return <NavGroupKnob key={group.testId} group={group} />
			})}
		</Bar>
	)
}

const Bar = styled.nav.withConfig({ displayName: 'BottomNavBar' })`
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 10;
	display: flex;
	align-items: center;
	justify-content: space-evenly;
	padding: var(--space-xs) 0;
	padding-bottom: calc(var(--space-xs) + env(safe-area-inset-bottom, 0px));
	min-height: var(--bottom-nav-space);

	/* Glassy bar — tinted pegboard color with backdrop blur so the workshop
	 * texture still bleeds through but text and icons remain legible. Matches
	 * marketing's ToolBelt so the shadow-board reads as one surface across
	 * apps. */
	background: color-mix(in oklab, var(--color-pegboard) 72%, transparent);
	backdrop-filter: blur(14px) saturate(1.4);
	-webkit-backdrop-filter: blur(14px) saturate(1.4);
	border-top: 1px solid var(--color-board-line);
	box-shadow: 0 -4px 16px var(--shadow-color);

	a {
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
		color: inherit;
		border-radius: var(--shape-full);

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 4px;
		}
	}

	@media (min-width: 1024px) {
		display: none;
	}
`
