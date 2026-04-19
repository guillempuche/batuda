import { motion } from 'motion/react'
import type { ComponentType } from 'react'
import styled, { css } from 'styled-components'

type IconComponent = ComponentType<{
	size?: number | string
	strokeWidth?: number | string
}>

/**
 * Workshop knob — a brushed-metal housing with a colored dome pushcap
 * stamped on top and a stenciled label below. Both the desktop SideNav
 * (`size='full'`) and the mobile BottomNav (`size='compact'`) render
 * through this component so Batuda's navigation reads as one continuous
 * shadow-board regardless of breakpoint. Active state pulses an amber
 * focus ring on the housing and brightens the cap.
 *
 * The cap color is driven by `--color-status-*` tokens — the caller
 * passes a solid token and the radial highlight/shadow sandwich is
 * computed here.
 */

export type MachineButtonSize = 'compact' | 'full'

const SIZE: Record<
	MachineButtonSize,
	{ housing: number; cap: number; icon: number; gap: string }
> = {
	compact: { housing: 44, cap: 28, icon: 16, gap: '4px' },
	full: { housing: 60, cap: 42, icon: 20, gap: '6px' },
}

interface MachineButtonProps {
	icon: IconComponent
	label: string
	color: string
	active: boolean
	size: MachineButtonSize
}

export function MachineButton({
	icon: Icon,
	label,
	color,
	active,
	size,
}: MachineButtonProps) {
	return (
		<Wrapper
			$size={size}
			whileHover={{ scale: 1.04 }}
			whileTap={{ scale: size === 'compact' ? 0.88 : 0.92 }}
			transition={{ type: 'spring', stiffness: 500, damping: 25 }}
		>
			<Housing $size={size} $active={active}>
				<Cap $size={size} $color={color} $active={active}>
					<Icon size={SIZE[size].icon} strokeWidth={2.5} />
				</Cap>
			</Housing>
			<Label $size={size} $active={active}>
				{label}
			</Label>
		</Wrapper>
	)
}

const Wrapper = styled(motion.span).withConfig({
	displayName: 'MachineButton',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $size: MachineButtonSize }>`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: ${p => SIZE[p.$size].gap};
	user-select: none;
	min-height: 44px;
	cursor: pointer;
	will-change: transform;
`

const Housing = styled.span.withConfig({
	displayName: 'MachineButtonHousing',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $size: MachineButtonSize; $active: boolean }>`
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
						? ', 0 0 14px 3px rgba(245, 158, 11, 0.45)'
						: ', 0 0 18px 4px rgba(245, 158, 11, 0.45)'
					: ''};
	display: flex;
	align-items: center;
	justify-content: center;
	position: relative;
	transition: box-shadow 240ms ease;

	${p =>
		p.$size === 'full' &&
		css`
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

const Cap = styled(motion.span).withConfig({
	displayName: 'MachineButtonCap',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $size: MachineButtonSize; $color: string; $active: boolean }>`
	width: ${p => SIZE[p.$size].cap}px;
	height: ${p => SIZE[p.$size].cap}px;
	border-radius: var(--shape-full);
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, ${p => p.$color} 88%, white) 0%,
		${p => p.$color} 55%,
		color-mix(in oklab, ${p => p.$color} 68%, black) 100%
	);
	border: 1px solid color-mix(in oklab, ${p => p.$color} 60%, black);
	box-shadow:
		inset 0 2px 4px rgba(255, 255, 255, ${p => (p.$active ? 0.5 : 0.3)}),
		inset 0 -2px 4px rgba(0, 0, 0, 0.2),
		0 2px 4px rgba(0, 0, 0, 0.25);
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	filter: ${p =>
		p.$active ? 'brightness(1.18) saturate(1.1)' : 'saturate(0.85)'};
	transition: filter 240ms ease;
`

const Label = styled.span.withConfig({
	displayName: 'MachineButtonLabel',
	shouldForwardProp: p => !p.startsWith('$'),
})<{ $size: MachineButtonSize; $active: boolean }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	line-height: 1.2;
	color: ${p =>
		p.$active ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)'};
	text-shadow: var(--text-shadow-emboss);
	text-align: center;
	transition: color 240ms ease;
`
