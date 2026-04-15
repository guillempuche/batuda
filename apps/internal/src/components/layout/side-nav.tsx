import { useLingui } from '@lingui/react'
import { Link } from '@tanstack/react-router'
import { Cog } from 'lucide-react'
import styled from 'styled-components'

import { ScrewDot } from '#/components/shared/workshop-decorations'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'
import { MachineButton } from './machine-button'
import { navItems } from './nav-items'
import { NavLink } from './nav-link'

/**
 * Desktop sidebar — a narrow pegboard column matching marketing's
 * `WorkshopDesktop`. A compact stamped-metal "Forja" plate sits at the
 * top (styled after the marketing `LogoPlateAnchor`), followed by a
 * scrollable rack of MachineButton knobs (shared with the mobile
 * BottomNav so Forja reads as one shadow-board across breakpoints),
 * and a brushed-metal profile plate anchored at the bottom.
 */
export function SideNav() {
	const { i18n } = useLingui()
	return (
		<Aside>
			<LogoPlate to='/' aria-label='Forja home'>
				<Cog size={12} aria-hidden />
				<span>Forja</span>
			</LogoPlate>
			<NavList>
				{navItems.map(item => {
					const Icon = item.icon
					const label = i18n._(item.label)
					return (
						<NavItem key={item.path}>
							<NavLink to={item.path} exact={item.exact} aria-label={label}>
								{({ isActive }) => (
									<MachineButton
										icon={Icon}
										label={label}
										color={item.color}
										active={isActive}
										size='full'
									/>
								)}
							</NavLink>
						</NavItem>
					)
				})}
			</NavList>
			<FooterLink to='/profile' aria-label='Open profile'>
				<FooterPlate>
					<ScrewDot $position='top-left' $size={4} aria-hidden />
					<ScrewDot $position='top-right' $size={4} aria-hidden />
					<AvatarDome>
						<Initial>U</Initial>
					</AvatarDome>
					<UserLabel>Profile</UserLabel>
				</FooterPlate>
			</FooterLink>
		</Aside>
	)
}

const Aside = styled.aside.withConfig({ displayName: 'SideNavAside' })`
	display: none;

	@media (min-width: 1024px) {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: var(--side-nav-width);
		flex-shrink: 0;
		height: 100dvh;
		min-height: 0;
		padding: var(--space-md) var(--space-xs) var(--space-sm);
		background-color: var(--color-pegboard);
		background-image:
			radial-gradient(
				circle at 2px 2px,
				rgba(0, 0, 0, 0.18) 1.5px,
				transparent 2px
			),
			radial-gradient(
				circle at 14px 14px,
				rgba(255, 255, 255, 0.05) 1px,
				transparent 1.5px
			);
		background-size: 24px 24px;
		box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.12);
	}
`

const LogoPlate = styled(Link).withConfig({ displayName: 'SideNavLogoPlate' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--space-2xs);
	background: linear-gradient(
		135deg,
		var(--color-metal-dark) 0%,
		var(--color-metal-light) 50%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid var(--color-outline);
	padding: var(--space-3xs) var(--space-xs);
	margin-bottom: var(--space-sm);
	box-shadow: var(--elevation-workshop-md);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	text-decoration: none;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 3px;
	}
`

const NavList = styled.ul.withConfig({ displayName: 'SideNavList' })`
	list-style: none;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--space-md);
	margin: 0;
	padding: var(--space-sm) 0;
	flex: 1;
	min-height: 0;
	width: 100%;
	overflow-y: auto;
	overflow-x: hidden;
	scrollbar-width: thin;
	scrollbar-color: rgba(0, 0, 0, 0.25) transparent;

	&::-webkit-scrollbar {
		width: 6px;
	}
	&::-webkit-scrollbar-thumb {
		background-color: rgba(0, 0, 0, 0.25);
		border-radius: var(--shape-full);
	}
`

const NavItem = styled.li.withConfig({ displayName: 'SideNavItem' })`
	a {
		display: inline-flex;
		border-radius: var(--shape-full);
		text-decoration: none;
		color: inherit;

		&:focus-visible {
			outline: none;
			box-shadow: var(--glow-active);
		}
	}
`

const FooterLink = styled(NavLink).withConfig({
	displayName: 'SideNavFooterLink',
})`
	display: block;
	margin-top: var(--space-sm);
	text-decoration: none;
	color: inherit;
	border-radius: var(--shape-2xs);

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const FooterPlate = styled.div.withConfig({
	displayName: 'SideNavFooterPlate',
})`
	${brushedMetalPlate}
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-xs) var(--space-2xs) var(--space-2xs);
	border-radius: var(--shape-2xs);
	transition:
		box-shadow 160ms ease,
		transform 160ms ease;

	&:hover {
		box-shadow: var(--elevation-workshop-md);
		transform: translateY(-1px);
	}
`

const AvatarDome = styled.div.withConfig({ displayName: 'SideNavAvatarDome' })`
	width: 36px;
	height: 36px;
	border-radius: var(--shape-full);
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, var(--color-status-prospect) 88%, white) 0%,
		var(--color-status-prospect) 55%,
		color-mix(in oklab, var(--color-status-prospect) 68%, black) 100%
	);
	border: 1px solid color-mix(in oklab, var(--color-status-prospect) 60%, black);
	box-shadow:
		inset 0 1px 2px rgba(255, 255, 255, 0.35),
		inset 0 -1px 2px rgba(0, 0, 0, 0.2),
		0 1px 2px rgba(0, 0, 0, 0.25);
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
`

const Initial = styled.span.withConfig({ displayName: 'SideNavInitial' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	line-height: 1;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
`

const UserLabel = styled.span.withConfig({ displayName: 'SideNavUserLabel' })`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: 0.08em;
`
