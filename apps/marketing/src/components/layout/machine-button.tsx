import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import styled, { css } from 'styled-components'

/* Section IDs the workshop nav can target. Used as both router hash and as
 * the lookup key for button colors so they stay in sync across mobile/desktop. */
export type NavTarget = 'hero' | 'solution' | 'pricing' | 'contact'

/* Each tool gets a distinct machine-button color, keyed by section id so it
 * survives translation. */
export const machineButtonColors: Record<NavTarget, string> = {
	hero: 'linear-gradient(145deg, #5A8A5A 0%, #4A7A4A 50%, #3A6A3A 100%)',
	solution: 'linear-gradient(145deg, #6A7A9A 0%, #5A6A8A 50%, #4A5A7A 100%)',
	pricing: 'linear-gradient(145deg, #C46A38 0%, #B05A28 50%, #9A4A18 100%)',
	contact: 'linear-gradient(145deg, #AA3A3A 0%, #992A2A 50%, #882020 100%)',
}

export const defaultMachineButtonColor =
	'linear-gradient(145deg, #888 0%, #777 50%, #666 100%)'

/* Two sizes — compact for the mobile tool belt, full for the desktop sidebar. */
type Size = 'compact' | 'full'

const SIZE: Record<Size, { housing: number; cap: number; icon: number }> = {
	compact: { housing: 44, cap: 30, icon: 16 },
	full: { housing: 60, cap: 42, icon: 20 },
}

const Wrapper = styled.div.withConfig({ displayName: 'MachineButton' })<{
	$size: Size
}>`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: ${p => (p.$size === 'compact' ? '4px' : '6px')};
	cursor: pointer;
	user-select: none;
	min-height: 44px;
`

const ButtonHousing = styled.div<{ $size: Size; $active: boolean }>`
	width: ${p => SIZE[p.$size].housing}px;
	height: ${p => SIZE[p.$size].housing}px;
	border-radius: var(--shape-full);
	background: linear-gradient(145deg, #9a9080 0%, #b0a690 40%, #8a8070 100%);
	border: 2px solid rgba(0, 0, 0, 0.2);
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.2),
		${p =>
			p.$size === 'compact'
				? '0 2px 4px rgba(0, 0, 0, 0.25)'
				: '0 2px 6px rgba(0, 0, 0, 0.25)'}
		${p =>
			p.$active
				? p.$size === 'compact'
					? ', 0 0 18px 5px rgba(255, 180, 100, 0.5), 0 0 6px 1px rgba(255, 160, 80, 0.3)'
					: ', 0 0 12px 2px rgba(255, 180, 100, 0.4)'
				: ''};
	display: flex;
	align-items: center;
	justify-content: center;
	position: relative;
	transition: box-shadow 0.3s;

	${p =>
		p.$size === 'full' &&
		css`
			/* Mounting screw dots at 12 and 6 o'clock */
			&::before,
			&::after {
				content: '';
				position: absolute;
				width: 5px;
				height: 5px;
				border-radius: var(--shape-full);
				background: radial-gradient(
					circle at 35% 35%,
					var(--color-metal-dark),
					var(--color-metal-deep)
				);
				border: 1px solid rgba(0, 0, 0, 0.15);
			}
			&::before {
				top: -1px;
			}
			&::after {
				bottom: -1px;
			}
		`}
`

const PushCap = styled(motion.div)<{
	$color: string
	$active: boolean
	$size: Size
}>`
	width: ${p => SIZE[p.$size].cap}px;
	height: ${p => SIZE[p.$size].cap}px;
	border-radius: var(--shape-full);
	background: ${p => p.$color};
	border: 1px solid rgba(0, 0, 0, 0.15);
	box-shadow:
		inset 0 2px ${p => (p.$size === 'compact' ? '3px' : '4px')}
			rgba(255, 255, 255, ${p => (p.$active ? 0.5 : 0.3)}),
		inset 0 -2px ${p => (p.$size === 'compact' ? '3px' : '4px')}
			rgba(0, 0, 0, 0.15),
		0 ${p => (p.$size === 'compact' ? '2px 4px' : '3px 6px')}
			rgba(0, 0, 0, 0.2);
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	filter: ${p =>
		p.$active
			? p.$size === 'compact'
				? 'brightness(1.4) saturate(1.2)'
				: 'brightness(1.2)'
			: 'none'};
	transition: filter 0.3s;
`

const Label = styled.span<{ $active: boolean }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	line-height: 1.2;
	color: ${p => (p.$active ? '#3A2C18' : 'var(--color-on-surface-variant)')};
	text-shadow: var(--text-shadow-emboss);
	text-align: center;
	transition: color 0.3s;
`

interface MachineButtonProps {
	icon: LucideIcon
	label: string
	target: NavTarget
	active: boolean
	size: Size
	hover?: boolean
}

export function MachineButton({
	icon: Icon,
	label,
	target,
	active,
	size,
	hover = true,
}: MachineButtonProps) {
	const color = machineButtonColors[target] ?? defaultMachineButtonColor
	return (
		<Wrapper $size={size}>
			<ButtonHousing $size={size} $active={active}>
				<PushCap
					$color={color}
					$active={active}
					$size={size}
					{...(hover && { whileHover: { scale: 1.06 } })}
					whileTap={{
						scale: size === 'compact' ? 0.85 : 0.9,
						boxShadow:
							'inset 0 2px 6px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.15)',
					}}
					transition={{ type: 'spring', stiffness: 500, damping: 25 }}
				>
					<Icon size={SIZE[size].icon} strokeWidth={2.5} />
				</PushCap>
			</ButtonHousing>
			<Label $active={active}>{label}</Label>
		</Wrapper>
	)
}
