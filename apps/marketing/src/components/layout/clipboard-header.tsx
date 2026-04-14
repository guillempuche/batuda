import { createLink } from '@tanstack/react-router'
import { Cog } from 'lucide-react'
import styled from 'styled-components'

import { useLang } from '#/i18n/lang-provider'

/* Compact metal plate pinned to the pegboard — phone only.
 * Matches desktop LogoPlate: small plate, not a full-width bar. */
const PlateWrapper = styled.header.withConfig({
	displayName: 'ClipboardHeader',
})`
	z-index: 10;
	display: flex;
	justify-content: center;
	padding-top: var(--space-sm);

	@media (min-width: 768px) {
		display: none;
	}
`

const PlateAnchor = styled.a`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-3xs) var(--space-sm);
	background:
		var(--texture-brushed-metal),
		linear-gradient(
			135deg,
			var(--color-metal-dark) 0%,
			var(--color-metal-light) 50%,
			var(--color-metal-dark) 100%
		);
	border: 1px solid var(--color-outline);
	box-shadow: var(--elevation-workshop-md);
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	text-decoration: none;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 3px;
	}
`

const Plate = createLink(PlateAnchor)

export function ClipboardHeader() {
	const lang = useLang()
	return (
		<PlateWrapper>
			<Plate to='/$lang' params={{ lang }} hash='hero'>
				<Cog size={16} />
				Engranatge
			</Plate>
		</PlateWrapper>
	)
}
