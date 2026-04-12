import { useLingui } from '@lingui/react/macro'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { PriTooltip } from '@engranatge/ui/pri'

import { navItems } from './nav-items'
import { NavLink } from './nav-link'

/**
 * Mobile fixed bottom navigation — a dark-leather tool belt with stitched
 * dividers and stencil uppercase labels under each icon. Visible at
 * <1024px; above that the desktop SideNav takes over and this bar hides.
 * Active tab glows with the warm amber focus ring.
 */
export function BottomNav() {
	const { t, i18n } = useLingui()
	return (
		<PriTooltip.Provider delay={500}>
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
								<PriTooltip.Root>
									<PriTooltip.Trigger
										render={
											<Tab
												as={motion.span}
												$active={isActive}
												whileTap={{ scale: 0.94 }}
											/>
										}
									>
										<Icon size={22} />
										<Label>{label}</Label>
									</PriTooltip.Trigger>
									<PriTooltip.Portal>
										<PriTooltip.Positioner side='top' sideOffset={8}>
											<PriTooltip.Popup>{label}</PriTooltip.Popup>
										</PriTooltip.Positioner>
									</PriTooltip.Portal>
								</PriTooltip.Root>
							)}
						</NavLink>
					)
				})}
			</Bar>
		</PriTooltip.Provider>
	)
}

const Bar = styled.nav.withConfig({ displayName: 'BottomNavBar' })`
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 10;
	display: flex;
	background-color: var(--color-leather-dark);
	background-image:
		radial-gradient(
			circle,
			rgba(255, 255, 255, 0.02) 1px,
			transparent 1px
		),
		linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 40%),
		linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0%, transparent 30%);
	background-size:
		8px 8px,
		100% 100%,
		100% 100%;
	border-top: 2px solid rgba(0, 0, 0, 0.6);
	box-shadow:
		0 -2px 6px rgba(0, 0, 0, 0.35),
		inset 0 1px 0 rgba(255, 255, 255, 0.06);
	padding-bottom: env(safe-area-inset-bottom, 0px);

	a {
		flex: 1;
		display: flex;
		text-decoration: none;
		color: inherit;
		position: relative;

		&:focus-visible {
			outline: none;
		}
		&:focus-visible > span {
			box-shadow: var(--glow-active);
		}
	}

	/* Stitching dividers between tabs */
	a + a::before {
		content: '';
		position: absolute;
		top: 20%;
		bottom: 20%;
		left: 0;
		border-left: 1px dashed rgba(255, 220, 180, 0.22);
	}

	@media (min-width: 1024px) {
		display: none;
	}
`

const Tab = styled.span.withConfig({
	displayName: 'BottomNavTab',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $active: boolean }>`
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-3xs);
	min-height: var(--bottom-nav-height);
	padding: var(--space-2xs) var(--space-xs);
	border-radius: var(--shape-2xs);
	color: ${p =>
		p.$active
			? 'color-mix(in oklab, var(--color-primary) 88%, white)'
			: 'rgba(245, 232, 210, 0.75)'};
	transition:
		color 160ms ease,
		box-shadow 160ms ease;
	${p =>
		p.$active &&
		`
			box-shadow: var(--glow-active);
			background: rgba(245, 158, 11, 0.12);
		`}
`

const Label = styled.span.withConfig({ displayName: 'BottomNavLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: 0.06em;
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
`
