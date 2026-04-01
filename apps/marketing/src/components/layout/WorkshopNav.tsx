import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import styled from 'styled-components'

import { useTranslations } from '#/i18n/LangProvider'

const Nav = styled.nav`
	position: sticky;
	top: 0;
	z-index: 10;
	background: var(--color-surface-container-lowest);
	border-bottom: 1px solid var(--color-outline-variant);
`

const NavInner = styled.div`
	max-width: var(--page-max-width);
	margin: 0 auto;
	padding: var(--space-sm) var(--page-gutter);
	display: flex;
	align-items: center;
	justify-content: space-between;
`

const Wordmark = styled(Link)`
	font-family: 'DM Sans', system-ui, sans-serif;
	font-size: var(--typescale-title-large-size);
	font-weight: 700;
	color: var(--color-on-surface);
	text-decoration: none;
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
`

const GearIcon = styled.span`
	display: inline-block;
	width: 1.25rem;
	height: 1.25rem;
	border-radius: var(--shape-full);
	border: 2px solid var(--color-primary);
	position: relative;

	&::after {
		content: '';
		position: absolute;
		inset: 3px;
		border-radius: var(--shape-full);
		background: var(--color-primary);
	}
`

const DesktopLinks = styled.div`
	display: none;
	align-items: center;
	gap: var(--space-lg);

	@media (min-width: 1024px) {
		display: flex;
	}
`

const NavLink = styled(Link)`
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	color: var(--color-on-surface-variant);
	text-decoration: none;
	transition: color 0.15s;

	&:hover {
		color: var(--color-primary);
	}

	&[data-status='active'] {
		color: var(--color-primary);
	}
`

const Hamburger = styled.button`
	display: flex;
	align-items: center;
	justify-content: center;
	width: 2.5rem;
	height: 2.5rem;
	background: none;
	border: none;
	cursor: pointer;
	color: var(--color-on-surface);

	@media (min-width: 1024px) {
		display: none;
	}
`

const MobilePanel = styled.div<{ $open: boolean }>`
	position: fixed;
	inset: 0;
	z-index: 20;
	background: var(--color-surface);
	padding: var(--space-xl) var(--page-gutter);
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
	transform: translateX(${p => (p.$open ? '0' : '100%')});
	transition: transform 0.25s ease;

	@media (min-width: 1024px) {
		display: none;
	}
`

const CloseButton = styled.button`
	align-self: flex-end;
	width: 2.5rem;
	height: 2.5rem;
	background: none;
	border: none;
	cursor: pointer;
	font-size: 1.5rem;
	color: var(--color-on-surface);
`

const MobileLink = styled(Link)`
	font-size: var(--typescale-title-large-size);
	font-weight: 500;
	color: var(--color-on-surface);
	text-decoration: none;
	padding: var(--space-xs) 0;

	&[data-status='active'] {
		color: var(--color-primary);
	}
`

export function WorkshopNav() {
	const t = useTranslations()
	const [open, setOpen] = useState(false)

	const links = [
		{ to: '/tools' as const, label: t.nav.tools },
		{ to: '/pricing' as const, label: t.nav.pricing },
	]

	return (
		<Nav>
			<NavInner>
				<Wordmark to='/'>
					<GearIcon />
					Engranatge
				</Wordmark>

				<DesktopLinks>
					{links.map(link => (
						<NavLink key={link.to} to={link.to}>
							{link.label}
						</NavLink>
					))}
				</DesktopLinks>

				<Hamburger onClick={() => setOpen(true)} aria-label='Menu'>
					<svg
						width='24'
						height='24'
						viewBox='0 0 24 24'
						fill='none'
						stroke='currentColor'
						strokeWidth='2'
						role='img'
						aria-label='Menu'
					>
						<path d='M3 12h18M3 6h18M3 18h18' />
					</svg>
				</Hamburger>
			</NavInner>

			<MobilePanel $open={open}>
				<CloseButton onClick={() => setOpen(false)} aria-label='Tanca'>
					&times;
				</CloseButton>
				{links.map(link => (
					<MobileLink key={link.to} to={link.to} onClick={() => setOpen(false)}>
						{link.label}
					</MobileLink>
				))}
			</MobilePanel>
		</Nav>
	)
}
