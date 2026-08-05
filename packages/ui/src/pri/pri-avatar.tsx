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
 *
 * `$size` sets the diameter; the bezel and the initials scale with it, so a
 * row-sized avatar keeps the same proportions as a full one rather than
 * turning into a thick ring around two unreadable letters.
 *
 *   <PriAvatar.Root $size='1.25rem'>…</PriAvatar.Root>
 */
const PriRoot = styled(Avatar.Root).withConfig({
	displayName: 'PriAvatarRoot',
	shouldForwardProp: prop => prop !== '$size',
})<{ $size?: string }>`
	--pri-avatar-size: ${p => p.$size ?? '2.25rem'};

	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: var(--pri-avatar-size);
	height: var(--pri-avatar-size);
	border-radius: 50%;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid var(--color-metal-edge);
	padding: calc(var(--pri-avatar-size) / 12);
	box-shadow:
		inset 0 1px 0 var(--highlight-inset-bright),
		0 1px 2px var(--shadow-color-strong);
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
	/* Initials do not shrink all the way down with the cap: past about a
	   row-height avatar a proportional letter stops being readable, so the
	   floor holds it legible while the bezel keeps getting smaller. */
	font-size: max(0.625rem, calc(var(--pri-avatar-size, 2.25rem) * 0.36));
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
