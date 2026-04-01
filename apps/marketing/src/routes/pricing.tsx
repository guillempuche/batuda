import { createFileRoute } from '@tanstack/react-router'
import styled from 'styled-components'

import { Section } from '#/components/layout/Section'
import { ControlPanel } from '#/components/workshop/ControlPanel'
import { GearMascot } from '#/components/workshop/GearMascot'
import { PartsRow } from '#/components/workshop/PartsRow'
import { services } from '#/data/services'
import { useLang, useTranslations } from '#/i18n/LangProvider'

export const Route = createFileRoute('/pricing')({
	component: Pricing,
})

const ServiceBlock = styled.div`
	margin-bottom: var(--space-2xl);
`

const ServiceName = styled.h3`
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-sm);
`

const IncludesSection = styled.div`
	margin-top: var(--space-lg);
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--space-lg);

	@media (max-width: 767px) {
		grid-template-columns: 1fr;
	}
`

const IncludesColumn = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
`

const IncludesLabel = styled.h4`
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	color: var(--color-on-surface-variant);
	text-transform: uppercase;
	letter-spacing: var(--typescale-label-large-tracking);
	margin-bottom: var(--space-2xs);
`

const IncludesItem = styled.p<{ $included: boolean }>`
	font-size: var(--typescale-body-medium-size);
	color: ${p =>
		p.$included ? 'var(--color-secondary)' : 'var(--color-on-surface-variant)'};

	&::before {
		content: '${p => (p.$included ? '✓' : '✗')}';
		margin-right: var(--space-xs);
	}
`

const ContactSection = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-xl);
	padding: var(--space-2xl);
	background: var(--color-surface-container-low);
	border-radius: var(--shape-sm);

	@media (max-width: 767px) {
		flex-direction: column;
		text-align: center;
	}
`

const ContactText = styled.p`
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface);
	flex: 1;
`

const ContactLink = styled.a`
	color: var(--color-primary);
	text-decoration: none;
	font-weight: 500;

	&:hover {
		text-decoration: underline;
	}
`

// TODO: move to i18n when scope grows
const includes: Record<string, { ca: string[]; es: string[]; en: string[] }> = {
	automatitzacions: {
		ca: [
			'Disseny del flux',
			'Implementació',
			'Test i posada en marxa',
			'Suport 30 dies',
		],
		es: [
			'Diseño del flujo',
			'Implementación',
			'Test y puesta en marcha',
			'Soporte 30 días',
		],
		en: ['Flow design', 'Implementation', 'Testing & launch', '30-day support'],
	},
	'intel-ligencia-artificial': {
		ca: [
			'Configuració del model',
			'Integració amb les teves eines',
			'Ajustaments inicials',
			'Suport continu',
		],
		es: [
			'Configuración del modelo',
			'Integración con tus herramientas',
			'Ajustes iniciales',
			'Soporte continuo',
		],
		en: [
			'Model configuration',
			'Integration with your tools',
			'Initial tuning',
			'Ongoing support',
		],
	},
	'micro-saas': {
		ca: [
			'Disseny UX',
			'Desenvolupament',
			'Deploy i hosting',
			'Manteniment mensual',
		],
		es: [
			'Diseño UX',
			'Desarrollo',
			'Deploy y hosting',
			'Mantenimiento mensual',
		],
		en: ['UX design', 'Development', 'Deploy & hosting', 'Monthly maintenance'],
	},
}

const excludes: Record<string, { ca: string[]; es: string[]; en: string[] }> = {
	automatitzacions: {
		ca: [
			'Subscripcions a tercers (Zapier, Make...)',
			"Canvis d'abast post-lliurament",
		],
		es: [
			'Suscripciones a terceros (Zapier, Make...)',
			'Cambios de alcance post-entrega',
		],
		en: [
			'Third-party subscriptions (Zapier, Make...)',
			'Scope changes after delivery',
		],
	},
	'intel-ligencia-artificial': {
		ca: ["Costos d'API d'IA (OpenAI, etc.)", 'Generació de contingut creatiu'],
		es: [
			'Costes de API de IA (OpenAI, etc.)',
			'Generación de contenido creativo',
		],
		en: ['AI API costs (OpenAI, etc.)', 'Creative content generation'],
	},
	'micro-saas': {
		ca: ['Contingut i dades inicials', 'Integracions no previstes'],
		es: ['Contenido y datos iniciales', 'Integraciones no previstas'],
		en: ['Initial content and data', 'Unplanned integrations'],
	},
}

function Pricing() {
	const t = useTranslations()
	const lang = useLang()

	return (
		<>
			<Section title={t.pricing.pageTitle} subtitle={t.pricing.pageSubtitle}>
				{services.map(service => (
					<ServiceBlock key={service.slug}>
						<ServiceName>{service.name[lang]}</ServiceName>
						<PartsRow
							name={service.name[lang]}
							description={service.tagline[lang]}
							price={service.startingPrice}
							unit={service.priceUnit[lang]}
						/>
						<IncludesSection>
							<IncludesColumn>
								<IncludesLabel>{t.pricing.includes}</IncludesLabel>
								{includes[service.slug]?.[lang].map(item => (
									<IncludesItem key={item} $included>
										{item}
									</IncludesItem>
								))}
							</IncludesColumn>
							<IncludesColumn>
								<IncludesLabel>{t.pricing.excludes}</IncludesLabel>
								{excludes[service.slug]?.[lang].map(item => (
									<IncludesItem key={item} $included={false}>
										{item}
									</IncludesItem>
								))}
							</IncludesColumn>
						</IncludesSection>
					</ServiceBlock>
				))}
			</Section>

			<Section>
				<ContactSection>
					<GearMascot expression='thinking' size={80} />
					<ContactText>
						{t.pricing.contact}
						<br />
						<ContactLink href='mailto:hola@engranatge.com'>
							hola@engranatge.com
						</ContactLink>
					</ContactText>
				</ContactSection>
			</Section>

			<Section>
				<ControlPanel
					heading={t.sections.cta}
					body={t.sections.ctaBody}
					primaryLabel={t.pricing.cta}
					primaryTo='/pricing'
					secondaryLabel={t.sections.ctaSecondary}
					secondaryHref='mailto:hola@engranatge.com'
				/>
			</Section>
		</>
	)
}
