import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { Gauge, MessageCircle, Receipt, Wrench } from 'lucide-react'
import styled from 'styled-components'

import { useTranslations } from '#/i18n/lang-provider'
import { useActiveSection } from './active-section-context'
import { MachineButton, type NavTarget } from './machine-button'

const Belt = styled.nav.withConfig({ displayName: 'ToolBelt' })`
	position: fixed;
	bottom: 0;
	left: 0;
	right: 0;
	z-index: 20;
	display: flex;
	align-items: center;
	justify-content: space-evenly;
	padding: var(--space-xs) 0;
	padding-bottom: calc(var(--space-xs) + env(safe-area-inset-bottom, 0px));
	min-height: var(--toolbelt-height);

	/* Glassy bar — tinted pegboard color with backdrop blur so the workshop
	 * texture still bleeds through but text and icons remain legible. */
	background: rgba(184, 168, 140, 0.72);
	backdrop-filter: blur(14px) saturate(1.4);
	-webkit-backdrop-filter: blur(14px) saturate(1.4);
	border-top: 1px solid rgba(80, 65, 45, 0.25);
	box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.12);

	@media (min-width: 768px) {
		display: none;
	}
`

const SlotLink = styled(Link)`
	text-decoration: none;
	display: flex;
	border-radius: var(--shape-full);

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 4px;
	}
`

const SlotAnchor = styled.a`
	text-decoration: none;
	display: flex;
	border-radius: var(--shape-full);

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 4px;
	}
`

interface TabDef {
	icon: LucideIcon
	target: NavTarget
	label: string
	href?: string
}

export function ToolBelt() {
	const activeSection = useActiveSection()
	const t = useTranslations()

	const tabs: TabDef[] = [
		{ icon: Gauge, target: 'hero', label: t.nav.home },
		{ icon: Wrench, target: 'solution', label: t.nav.solution },
		{ icon: Receipt, target: 'pricing', label: t.nav.quote },
		{ icon: MessageCircle, target: 'contact', label: t.nav.contact },
	]

	return (
		<Belt>
			{tabs.map(tab => {
				const isActive = activeSection === tab.target

				const button = (
					<MachineButton
						icon={tab.icon}
						label={tab.label}
						target={tab.target}
						active={isActive}
						size='compact'
						hover={false}
					/>
				)

				if (tab.href) {
					return (
						<SlotAnchor key={tab.target} href={tab.href}>
							{button}
						</SlotAnchor>
					)
				}

				return (
					<SlotLink key={tab.target} to='/' hash={tab.target}>
						{button}
					</SlotLink>
				)
			})}
		</Belt>
	)
}
