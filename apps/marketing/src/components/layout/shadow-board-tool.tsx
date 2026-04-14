import { createLink } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import styled from 'styled-components'

import { useLang } from '#/i18n/lang-provider'
import { useActiveSection } from './active-section-context'
import { MachineButton, type NavTarget } from './machine-button'

/* The actual interactive element wrapping the visual MachineButton. We render
 * a real anchor (or button) so it stays keyboard accessible — the visual
 * machinery is purely presentational. */
const AnchorWrap = styled.a`
	text-decoration: none;
	border-radius: var(--shape-full);
	display: inline-flex;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 4px;
	}
`

const LinkWrap = createLink(AnchorWrap)

interface Props {
	icon: LucideIcon
	label: string
	scrollTo?: NavTarget
	href?: string
}

export function ShadowBoardTool({ icon, label, scrollTo, href }: Props) {
	const activeSection = useActiveSection()
	const lang = useLang()
	const isActive = scrollTo ? activeSection === scrollTo : false

	const button = (
		<MachineButton
			icon={icon}
			label={label}
			target={scrollTo ?? 'hero'}
			active={isActive}
			size='full'
		/>
	)

	if (href) {
		return <AnchorWrap href={href}>{button}</AnchorWrap>
	}

	if (scrollTo) {
		return (
			<LinkWrap to='/$lang' params={{ lang }} hash={scrollTo}>
				{button}
			</LinkWrap>
		)
	}

	return button
}
