import { useLingui } from '@lingui/react/macro'
import styled from 'styled-components'

import { navItems } from './nav-items'
import { NavLink } from './nav-link'

/**
 * Mobile fixed bottom navigation — visible at <1024px viewports.
 * On desktop the bar hides via `@media` below (the side-nav takes over).
 *
 * Icon above label for maximum scannability. 44px hit targets. Respects
 * iOS safe area so the tab row never sits under the home indicator.
 */
export function BottomNav() {
	const { t, i18n } = useLingui()
	return (
		<Bar role='navigation' aria-label={t`Primary navigation`}>
			{navItems.map(item => {
				const Icon = item.icon
				const label = i18n._(item.label)
				return (
					<NavLink
						key={item.path}
						to={item.path}
						exact={item.exact}
						aria-label={label}
					>
						{({ isActive }) => (
							<Tab $active={isActive}>
								<Icon size={22} />
								<Label>{label}</Label>
							</Tab>
						)}
					</NavLink>
				)
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
	background: var(--color-surface-container-low);
	border-top: 1px solid var(--color-outline-variant);
	padding-bottom: env(safe-area-inset-bottom, 0px);

	a {
		flex: 1;
		display: flex;
		text-decoration: none;
		color: inherit;

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: -2px;
		}
	}

	@media (min-width: 1024px) {
		display: none;
	}
`

const Tab = styled.span.withConfig({ displayName: 'BottomNavTab' })<{
	$active: boolean
}>`
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-3xs);
	min-height: var(--bottom-nav-height);
	padding: var(--space-2xs) var(--space-xs);
	color: ${p =>
		p.$active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'};
	transition: color 120ms ease;
`

const Label = styled.span.withConfig({ displayName: 'BottomNavLabel' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: var(--typescale-label-small-tracking);
	font-weight: var(--typescale-label-small-weight);
`
