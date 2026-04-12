import { useLingui } from '@lingui/react'
import { Cog } from 'lucide-react'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { PriAvatar } from '@engranatge/ui/pri'

import { ScrewDot } from '#/components/shared/workshop-decorations'
import {
	brushedMetalBezel,
	brushedMetalPlate,
	stenciledTitle,
} from '#/lib/workshop-mixins'
import { navItems } from './nav-items'
import { NavLink } from './nav-link'

/**
 * Desktop sidebar — rendered as a pegboard rack with a metal LogoPlate up
 * top, a column of shadow-board "tool" rows (metal bezel + colored dome
 * cap + embossed stencil label), and a sheet-metal footer plate with the
 * current user. Visible only at ≥1024px; mobile falls back to BottomNav.
 */
export function SideNav() {
	const { i18n } = useLingui()
	return (
		<Aside>
			<LogoPlate>
				<Cog size={20} aria-hidden />
				<Wordmark>Engranatge</Wordmark>
				<Subtitle>Forja</Subtitle>
			</LogoPlate>
			<NavList>
				{navItems.map(item => {
					const Icon = item.icon
					const label = i18n._(item.label)
					return (
						<NavItem key={item.path}>
							<NavLink to={item.path} exact={item.exact} aria-label={label}>
								{({ isActive }) => (
									<ToolRow
										as={motion.span}
										$active={isActive}
										whileHover={{ x: 2, scale: 1.01 }}
										whileTap={{ scale: 0.98 }}
									>
										<Bezel $color={item.color} $active={isActive}>
											<DomeCap $color={item.color} $active={isActive}>
												<Icon size={18} />
											</DomeCap>
										</Bezel>
										<Label>{label}</Label>
									</ToolRow>
								)}
							</NavLink>
						</NavItem>
					)
				})}
			</NavList>
			<FooterPlate>
				<ScrewDot $position='top-left' $size={5} aria-hidden />
				<ScrewDot $position='top-right' $size={5} aria-hidden />
				<PriAvatar.Root>
					<PriAvatar.Fallback>U</PriAvatar.Fallback>
				</PriAvatar.Root>
				<UserName>User</UserName>
			</FooterPlate>
		</Aside>
	)
}

const Aside = styled.aside.withConfig({ displayName: 'SideNavAside' })`
	display: none;

	@media (min-width: 1024px) {
		position: relative;
		display: flex;
		flex-direction: column;
		width: var(--side-nav-width);
		flex-shrink: 0;
		height: 100dvh;
		padding: var(--space-lg) var(--space-md) var(--space-md);
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

const LogoPlate = styled.div.withConfig({ displayName: 'SideNavLogoPlate' })`
	${brushedMetalPlate}
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-md) var(--space-md);
	margin-bottom: var(--space-lg);
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-md);
	color: var(--color-on-surface);
`

const Wordmark = styled.h1.withConfig({ displayName: 'SideNavWordmark' })`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	letter-spacing: 0.12em;
`

const Subtitle = styled.p.withConfig({ displayName: 'SideNavSubtitle' })`
	margin-left: auto;
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
	text-transform: uppercase;
`

const NavList = styled.ul.withConfig({ displayName: 'SideNavList' })`
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	margin: 0;
	padding: 0;
`

const NavItem = styled.li.withConfig({ displayName: 'SideNavItem' })`
	a {
		display: block;
		text-decoration: none;
		color: inherit;

		&:focus-visible {
			outline: none;
		}
		&:focus-visible > span {
			box-shadow: var(--glow-active);
		}
	}
`

const ToolRow = styled.span.withConfig({
	displayName: 'SideNavToolRow',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $active: boolean }>`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-2xs) var(--space-2xs);
	border-radius: var(--shape-2xs);
	transition: background 160ms ease;
	will-change: transform;

	${p =>
		p.$active &&
		`
			background: rgba(245, 158, 11, 0.12);
			box-shadow: var(--glow-active);
		`}
`

const Bezel = styled.span.withConfig({
	displayName: 'SideNavBezel',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $color: string; $active: boolean }>`
	${brushedMetalBezel}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	border-radius: 50%;
	flex-shrink: 0;
`

const DomeCap = styled.span.withConfig({
	displayName: 'SideNavDomeCap',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $color: string; $active: boolean }>`
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 30px;
	height: 30px;
	border-radius: 50%;
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, ${p => p.$color} 85%, white) 0%,
		${p => p.$color} 55%,
		color-mix(in oklab, ${p => p.$color} 70%, black) 100%
	);
	border: 1px solid color-mix(in oklab, ${p => p.$color} 60%, black);
	color: #fff;
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.35),
		0 1px 2px rgba(0, 0, 0, 0.3);
	filter: ${p => (p.$active ? 'none' : 'saturate(0.85)')};
`

const Label = styled.span.withConfig({ displayName: 'SideNavLabel' })`
	${stenciledTitle}
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
`

const FooterPlate = styled.div.withConfig({
	displayName: 'SideNavFooterPlate',
})`
	${brushedMetalPlate}
	margin-top: auto;
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const UserName = styled.span.withConfig({ displayName: 'SideNavUserName' })`
	${stenciledTitle}
	font-size: var(--typescale-label-large-size);
	letter-spacing: 0.06em;
`
