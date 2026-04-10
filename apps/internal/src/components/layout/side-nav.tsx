import { useLingui } from '@lingui/react'
import styled from 'styled-components'

import { navItems } from './nav-items'
import { NavLink } from './nav-link'

/**
 * Desktop sidebar — visible at ≥1024px viewports via `@media` below.
 * On mobile the entire aside collapses (the bottom-nav takes over).
 *
 * Layout: brand header at the top, vertical nav list, user row pinned to
 * the bottom via `margin-top: auto`. 240px fixed width so the CRM body
 * has a stable writing column.
 */
export function SideNav() {
	const { i18n } = useLingui()
	return (
		<Aside>
			<Brand>
				<Wordmark>Engranatge</Wordmark>
				<Subtitle>Forja — CRM</Subtitle>
			</Brand>
			<NavList>
				{navItems.map(item => {
					const Icon = item.icon
					const label = i18n._(item.label)
					return (
						<NavItem key={item.path}>
							<NavLink to={item.path} exact={item.exact} aria-label={label}>
								{({ isActive }) => (
									<NavRow $active={isActive}>
										<Icon size={20} />
										<Label>{label}</Label>
									</NavRow>
								)}
							</NavLink>
						</NavItem>
					)
				})}
			</NavList>
			<UserRow>
				<Avatar aria-hidden>U</Avatar>
				<UserName>User</UserName>
			</UserRow>
		</Aside>
	)
}

const Aside = styled.aside.withConfig({ displayName: 'SideNavAside' })`
	display: none;

	@media (min-width: 1024px) {
		display: flex;
		flex-direction: column;
		width: var(--side-nav-width);
		flex-shrink: 0;
		height: 100dvh;
		background: var(--color-surface-container-low);
		border-right: 1px solid var(--color-outline-variant);
		padding: var(--space-lg) var(--space-md);
	}
`

const Brand = styled.div.withConfig({ displayName: 'SideNavBrand' })`
	padding: var(--space-xs) var(--space-sm) var(--space-lg);
`

const Wordmark = styled.h1.withConfig({ displayName: 'SideNavWordmark' })`
	font-family: var(--font-display);
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-primary);
	letter-spacing: -0.01em;
`

const Subtitle = styled.p.withConfig({ displayName: 'SideNavSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	letter-spacing: var(--typescale-label-medium-tracking);
	color: var(--color-on-surface-variant);
	margin-top: var(--space-3xs);
	text-transform: uppercase;
`

const NavList = styled.ul.withConfig({ displayName: 'SideNavList' })`
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	margin: 0;
	padding: 0;
`

const NavItem = styled.li.withConfig({ displayName: 'SideNavItem' })`
	a {
		display: block;
		text-decoration: none;
		color: inherit;
		border-radius: var(--shape-sm);

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 2px;
		}
	}
`

const NavRow = styled.span.withConfig({ displayName: 'SideNavRow' })<{
	$active: boolean
}>`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-sm);
	background: ${p =>
		p.$active ? 'var(--color-secondary-container)' : 'transparent'};
	color: ${p =>
		p.$active
			? 'var(--color-on-secondary-container)'
			: 'var(--color-on-surface-variant)'};
	transition:
		background 120ms ease,
		color 120ms ease;

	&:hover {
		background: var(--color-surface-container);
		color: var(--color-on-surface);
	}
`

const Label = styled.span.withConfig({ displayName: 'SideNavLabel' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	letter-spacing: var(--typescale-label-large-tracking);
	font-weight: var(--typescale-label-large-weight);
`

const UserRow = styled.div.withConfig({ displayName: 'SideNavUserRow' })`
	margin-top: auto;
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-top: 1px solid var(--color-outline-variant);
`

const Avatar = styled.span.withConfig({ displayName: 'SideNavAvatar' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border-radius: var(--shape-full);
	background: var(--color-primary);
	color: var(--color-on-primary);
	font-family: var(--font-display);
	font-weight: var(--font-weight-bold);
	font-size: var(--typescale-label-large-size);
`

const UserName = styled.span.withConfig({ displayName: 'SideNavUserName' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);
`
