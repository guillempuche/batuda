import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { useActiveSection } from './active-section-context'

/* Machine button — industrial push button on the pegboard panel */
const Slot = styled.button.attrs({ 'data-component': 'ShadowBoardTool' })`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	cursor: pointer;
	user-select: none;
	background: none;
	border: none;
	padding: 0;
`

/* Circular housing ring — the bezel around the button */
const ButtonHousing = styled.div<{ $active?: boolean }>`
	width: 60px;
	height: 60px;
	border-radius: var(--shape-full);
	background:
		linear-gradient(
			145deg,
			#9A9080 0%,
			#B0A690 40%,
			#8A8070 100%
		);
	border: 2px solid rgba(0, 0, 0, 0.2);
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.2),
		0 2px 6px rgba(0, 0, 0, 0.25)
		${p => (p.$active ? ', 0 0 12px 2px rgba(255, 180, 100, 0.4)' : '')};
	display: flex;
	align-items: center;
	justify-content: center;
	position: relative;
	transition: box-shadow 0.3s;

	/* Mounting screw dots at 12 and 6 o'clock */
	&::before,
	&::after {
		content: '';
		position: absolute;
		width: 5px;
		height: 5px;
		border-radius: var(--shape-full);
		background: radial-gradient(circle at 35% 35%, var(--color-metal-dark), var(--color-metal-deep));
		border: 1px solid rgba(0, 0, 0, 0.15);
	}
	&::before { top: -1px; }
	&::after { bottom: -1px; }
`

/* The actual push cap — raised dome that depresses */
const PushCap = styled(motion.div)<{ $color: string; $active?: boolean }>`
	width: 42px;
	height: 42px;
	border-radius: var(--shape-full);
	background: ${p => p.$color};
	border: 1px solid rgba(0, 0, 0, 0.15);
	box-shadow:
		inset 0 2px 4px rgba(255, 255, 255, ${p => (p.$active ? 0.5 : 0.3)}),
		inset 0 -2px 4px rgba(0, 0, 0, 0.15),
		0 3px 6px rgba(0, 0, 0, 0.2);
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	/* Active = brighter, like a lit indicator lamp */
	filter: ${p => (p.$active ? 'brightness(1.2)' : 'none')};
	transition: filter 0.3s;
`

const Label = styled.span<{ $active?: boolean }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	line-height: 1.2;
	color: ${p => (p.$active ? '#4A3A20' : 'var(--color-on-surface-variant)')};
	text-align: center;
	text-shadow: var(--text-shadow-emboss);
	transition: color 0.3s;
`

/* Each tool gets a distinct machine-button color */
const buttonColors: Record<string, string> = {
	Inici: 'linear-gradient(145deg, #5A8A5A 0%, #4A7A4A 50%, #3A6A3A 100%)',
	Eines: 'linear-gradient(145deg, #6A7A9A 0%, #5A6A8A 50%, #4A5A7A 100%)',
	Preus: 'linear-gradient(145deg, #C46A38 0%, #B05A28 50%, #9A4A18 100%)',
	Parla: 'linear-gradient(145deg, #AA3A3A 0%, #992A2A 50%, #882020 100%)',
}

const defaultColor = 'linear-gradient(145deg, #888 0%, #777 50%, #666 100%)'

/* Map scrollTo target → section ID for active detection */
const sectionMap: Record<string, string> = {
	hero: 'hero',
	solution: 'solution',
	pricing: 'pricing',
	contact: 'contact',
}

interface Props {
	icon: LucideIcon
	label: string
	scrollTo?: string
	href?: string
}

export function ShadowBoardTool({ icon: Icon, label, scrollTo, href }: Props) {
	const activeSection = useActiveSection()
	const color = buttonColors[label] ?? defaultColor
	const sectionId = scrollTo ? sectionMap[scrollTo] : undefined
	const isActive = sectionId ? activeSection === sectionId : false

	const buttonContent = (
		<Slot as='div'>
			<ButtonHousing $active={isActive}>
				<PushCap
					$color={color}
					$active={isActive}
					whileHover={{ scale: 1.06 }}
					whileTap={{
						scale: 0.9,
						boxShadow:
							'inset 0 2px 6px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.15)',
					}}
					transition={{ type: 'spring', stiffness: 500, damping: 25 }}
				>
					<Icon size={20} strokeWidth={2.5} />
				</PushCap>
			</ButtonHousing>
			<Label $active={isActive}>{label}</Label>
		</Slot>
	)

	if (href) {
		return (
			<a href={href} style={{ textDecoration: 'none' }}>
				{buttonContent}
			</a>
		)
	}

	if (scrollTo) {
		return (
			<Link to='/' hash={scrollTo} style={{ textDecoration: 'none' }}>
				{buttonContent}
			</Link>
		)
	}

	return buttonContent
}
