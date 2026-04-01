import { Link } from '@tanstack/react-router'
import styled from 'styled-components'

import { useTranslations } from '#/i18n/LangProvider'

const Footer = styled.footer`
	background: var(--color-inverse-surface);
	color: var(--color-inverse-on-surface);
	padding: var(--space-4xl) var(--page-gutter);
	margin-top: var(--space-5xl);
`

const FooterInner = styled.div`
	max-width: var(--page-max-width);
	margin: 0 auto;
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-2xl);

	@media (min-width: 768px) {
		grid-template-columns: 2fr 1fr 1fr;
	}
`

const Brand = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const BrandName = styled.span`
	font-family: 'DM Sans', system-ui, sans-serif;
	font-size: var(--typescale-title-large-size);
	font-weight: 700;
	color: var(--color-inverse-primary);
`

const Tagline = styled.p`
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-inverse-on-surface);
	opacity: 0.8;
`

const Column = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
`

const ColumnTitle = styled.h3`
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	letter-spacing: var(--typescale-label-large-tracking);
	text-transform: uppercase;
	opacity: 0.6;
	margin-bottom: var(--space-2xs);
`

const FooterLink = styled(Link)`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-inverse-on-surface);
	text-decoration: none;
	opacity: 0.8;
	transition: opacity 0.15s;

	&:hover {
		opacity: 1;
		color: var(--color-inverse-primary);
	}
`

const ExternalLink = styled.a`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-inverse-on-surface);
	text-decoration: none;
	opacity: 0.8;
	transition: opacity 0.15s;

	&:hover {
		opacity: 1;
		color: var(--color-inverse-primary);
	}
`

const Bottom = styled.div`
	max-width: var(--page-max-width);
	margin: var(--space-2xl) auto 0;
	padding-top: var(--space-lg);
	border-top: 1px solid rgb(255 255 255 / 0.1);
	display: flex;
	justify-content: space-between;
	font-size: var(--typescale-body-small-size);
	opacity: 0.5;
`

export function WorkshopFooter() {
	const t = useTranslations()

	return (
		<Footer>
			<FooterInner>
				<Brand>
					<BrandName>Engranatge</BrandName>
					<Tagline>{t.footer.tagline}</Tagline>
					<ExternalLink href='mailto:hola@engranatge.com'>
						hola@engranatge.com
					</ExternalLink>
				</Brand>

				<Column>
					<ColumnTitle>{t.nav.tools}</ColumnTitle>
					<FooterLink to='/tools'>{t.nav.tools}</FooterLink>
					<FooterLink to='/pricing'>{t.nav.pricing}</FooterLink>
				</Column>

				<Column>
					<ColumnTitle>{t.footer.contact}</ColumnTitle>
					<ExternalLink href='mailto:hola@engranatge.com'>
						hola@engranatge.com
					</ExternalLink>
				</Column>
			</FooterInner>

			<Bottom>
				<span>{t.footer.madeIn}</span>
				<span>&copy; {new Date().getFullYear()} Engranatge</span>
			</Bottom>
		</Footer>
	)
}
