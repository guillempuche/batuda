import styled from 'styled-components'

import { useTranslations } from '#/i18n/lang-provider'

/* Workshop label plate — simplified metal footer for mobile */
const Footer = styled.footer.attrs({ 'data-component': 'WorkshopFooter' })`
	background:
		var(--texture-brushed-metal),
		linear-gradient(
			180deg,
			#a8a8a8 0%,
			#c0c0c0 20%,
			#b0b0b0 80%,
			#909090 100%
		);
	padding: var(--space-xl) var(--page-gutter);
	/* Extra bottom padding for tool belt */
	padding-bottom: calc(var(--space-xl) + 4rem);
	text-align: center;
	border-top: 1px solid rgba(0, 0, 0, 0.1);

	@media (min-width: 1024px) {
		display: none;
	}
`

const BrandStamp = styled.div`
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #555;
	text-shadow: var(--text-shadow-emboss);
	margin-bottom: var(--space-xs);
`

const FooterText = styled.span`
	display: block;
	font-size: var(--typescale-body-small-size);
	color: #666;
	text-shadow: var(--text-shadow-emboss);
`

const FooterLink = styled.a`
	color: #444;
	text-decoration: none;
	font-size: var(--typescale-body-small-size);
	font-weight: 500;
	text-shadow: var(--text-shadow-emboss);

	&:hover {
		color: var(--color-primary);
	}
`

export function WorkshopFooter() {
	const t = useTranslations()

	return (
		<Footer>
			<BrandStamp>Engranatge</BrandStamp>
			<FooterText>{t.footer.madeIn}</FooterText>
			<FooterLink href='mailto:hola@engranatge.com'>
				hola@engranatge.com
			</FooterLink>
			<FooterText>&copy; {new Date().getFullYear()} Engranatge</FooterText>
		</Footer>
	)
}
