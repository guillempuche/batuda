import { Avatar } from '@base-ui/react/avatar'
import styled from 'styled-components'

/**
 * Workshop avatar — brushed metal bezel ring. When no image is available,
 * the fallback is a terracotta dome cap with the user's embossed initials.
 *
 *   <PriAvatar.Root>
 *     <PriAvatar.Image src={…} />
 *     <PriAvatar.Fallback>GP</PriAvatar.Fallback>
 *   </PriAvatar.Root>
 */
const PriRoot = styled(Avatar.Root).withConfig({
	displayName: 'PriAvatarRoot',
})`
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	border-radius: 50%;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.3);
	padding: 3px;
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.5),
		0 1px 2px rgba(0, 0, 0, 0.2);
	overflow: hidden;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--texture-brushed-metal);
		pointer-events: none;
	}
`

const PriImage = styled(Avatar.Image).withConfig({
	displayName: 'PriAvatarImage',
})`
	width: 100%;
	height: 100%;
	border-radius: 50%;
	object-fit: cover;
	position: relative;
	z-index: 1;
`

const PriFallback = styled(Avatar.Fallback).withConfig({
	displayName: 'PriAvatarFallback',
})`
	position: relative;
	z-index: 1;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	border-radius: 50%;
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, var(--color-primary) 88%, white) 0%,
		var(--color-primary) 55%,
		color-mix(in oklab, var(--color-primary) 70%, black) 100%
	);
	color: var(--color-on-primary);
	font-family: var(--font-display);
	font-size: 0.8125rem;
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
`

export const PriAvatar = {
	Root: PriRoot,
	Image: PriImage,
	Fallback: PriFallback,
}
