import { createFileRoute, Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { useSectionRef } from '#/components/layout/active-section-context'
import { Section } from '#/components/layout/section'
import { BeforeAfter } from '#/components/workshop/before-after'
import { ControlPanel } from '#/components/workshop/control-panel'
import { ConveyorBelt } from '#/components/workshop/conveyor-belt'
import { GearMascot } from '#/components/workshop/gear-mascot'
import { MachineCard } from '#/components/workshop/machine-card'
import { PartsRow } from '#/components/workshop/parts-row'
import { services } from '#/data/services'
import { useLang, useTranslations } from '#/i18n/lang-provider'

/* ─── Animation variants ─── */

const fadeUp = {
	hidden: { opacity: 0, y: 20 },
	visible: { opacity: 1, y: 0 },
}

const staggerContainer = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.1 } },
}

export const Route = createFileRoute('/')({
	component: Home,
})

/* ─── Styled components ─── */

const HeroSection = styled.section.attrs({ 'data-component': 'HeroSection' })`
	padding: var(--space-5xl) var(--page-gutter) var(--space-4xl);
	max-width: var(--page-max-width);
	margin: 0 auto;
`

const HeroContent = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-2xl);

	@media (max-width: 767px) {
		flex-direction: column;
		text-align: center;
	}
`

const HeroText = styled.div`
	flex: 1;
`

const Headline = styled.h1`
	font-family: var(--font-display);
	font-size: var(--typescale-display-large-size);
	line-height: var(--typescale-display-large-line);
	font-weight: var(--typescale-display-large-weight);
	letter-spacing: var(--typescale-display-large-tracking);
	color: var(--color-on-surface);
	margin-bottom: var(--space-md);

	@media (max-width: 767px) {
		font-size: var(--typescale-display-medium-size);
		line-height: var(--typescale-display-medium-line);
	}
`

const Subheadline = styled.p`
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-xl);
`

const HeroCta = styled(Link)`
	display: inline-flex;
	align-items: center;
	padding: var(--space-sm) var(--space-2xl);
	background: linear-gradient(135deg, #b85a28 0%, #c46a38 50%, #a04a18 100%);
	border: 1px solid rgba(0, 0, 0, 0.2);
	box-shadow: var(--elevation-workshop-md);
	color: var(--color-on-primary);
	border-radius: 2px;
	font-size: var(--typescale-label-large-size);
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-engrave);
	text-decoration: none;
	transition:
		box-shadow 0.15s,
		transform 0.1s;
	cursor: pointer;

	&:hover {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.25),
			0 3px 6px rgba(0, 0, 0, 0.2);
	}

	&:active {
		transform: translateY(1px);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.1);
	}
`

const ServiceGrid = styled(motion.div).attrs({
	'data-component': 'ServiceGrid',
})`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 1024px) {
		grid-template-columns: repeat(3, 1fr);
	}
`

const ProofGrid = styled(motion.div).attrs({ 'data-component': 'ProofGrid' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(2, 1fr);
	}
`

/* Index card pinned to the board */
const ProofCard = styled.div.attrs({ 'data-component': 'ProofCard' })`
	padding: var(--space-lg);
	padding-top: calc(var(--space-lg) + 6px);
	background:
		linear-gradient(160deg, var(--color-metal-light) 0%, var(--color-metal) 50%, var(--color-metal-dark) 100%);
	border: 1px solid var(--color-outline);
	position: relative;
	transition: transform 0.3s ease;

	/* Alternating tilt */
	&:nth-child(odd) { transform: rotate(0.5deg); }
	&:nth-child(even) { transform: rotate(-0.4deg); }

	&:hover { transform: rotate(0deg); }

	/* Pin/tack at top center */
	&::before {
		content: '';
		position: absolute;
		top: 6px;
		left: 50%;
		transform: translateX(-50%);
		width: 10px;
		height: 10px;
		border-radius: var(--shape-full);
		background: radial-gradient(circle at 35% 35%, #D4544A, #A03030);
		border: 1px solid rgba(0, 0, 0, 0.2);
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
	}
`

const ProofIndustry = styled.span`
	display: inline-block;
	font-size: var(--typescale-label-small-size);
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-primary);
	margin-bottom: var(--space-xs);
`

const ProofProblem = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-xs);
`

const ProofResult = styled.p`
	font-size: var(--typescale-body-medium-size);
	font-weight: 500;
	color: var(--color-secondary);
`

const PricingBlock = styled.div.attrs({ 'data-component': 'PricingBlock' })`
	margin-bottom: var(--space-2xl);
`

const PricingName = styled.h3`
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-sm);
`

const IncludesGrid = styled.div`
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
	font-weight: 700;
	color: var(--color-on-surface-variant);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	margin-bottom: var(--space-2xs);
`

const IncludesItem = styled.p<{ $included: boolean }>`
	font-size: var(--typescale-body-medium-size);
	color: ${p =>
		p.$included ? 'var(--color-secondary)' : 'var(--color-on-surface-variant)'};

	&::before {
		content: '${p => (p.$included ? '\u2713' : '\u2717')}';
		margin-right: var(--space-xs);
	}
`

/* ─── Data ─── */

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

/* ─── Page ─── */

function Home() {
	const t = useTranslations()
	const lang = useLang()
	const heroRef = useSectionRef('hero')
	const solutionRef = useSectionRef('solution')
	const pricingRef = useSectionRef('pricing')
	const contactRef = useSectionRef('contact')

	const beforeAfterItems = [
		t.beforeAfter.invoices,
		t.beforeAfter.followUp,
		t.beforeAfter.orders,
	]

	const conveyorItems = beforeAfterItems.map(item => ({
		before: item.before,
		after: item.after,
	}))

	/* Collect all examples from all services */
	const allExamples = services.flatMap(service =>
		service.examples[lang].map(ex => ({
			...ex,
			serviceName: service.name[lang],
		})),
	)

	return (
		<>
			{/* ── 1. HOOK ── */}
			<HeroSection id='hero' ref={heroRef}>
				<HeroContent>
					<HeroText>
						<Headline>{t.hero.headline}</Headline>
						<Subheadline>{t.hero.subheadline}</Subheadline>
						<motion.div
							style={{ display: 'inline-block' }}
							whileHover={{ scale: 1.03 }}
							whileTap={{ scale: 0.97 }}
							transition={{ type: 'spring', stiffness: 400, damping: 20 }}
						>
							<HeroCta to='/' hash='contact'>
								{t.hero.cta}
							</HeroCta>
						</motion.div>
					</HeroText>
					<GearMascot expression='default' size={120} />
				</HeroContent>
			</HeroSection>

			{/* ── 2. PROBLEM ── */}
			<ConveyorBelt items={conveyorItems} />

			<motion.div
				variants={fadeUp}
				initial='hidden'
				whileInView='visible'
				viewport={{ once: true, amount: 0.2 }}
				transition={{ duration: 0.5 }}
			>
				<Section id='problem' title={t.sections.beforeAfter}>
					<BeforeAfter
						items={beforeAfterItems}
						beforeLabel={t.sections.beforeLabel}
						afterLabel={t.sections.afterLabel}
					/>
				</Section>
			</motion.div>

			{/* ── 3. SOLUTION ── */}
			<div ref={solutionRef}>
				<Section id='solution' title={t.sections.services}>
					<ServiceGrid
						variants={staggerContainer}
						initial='hidden'
						whileInView='visible'
						viewport={{ once: true, amount: 0.2 }}
					>
						{services.map(service => (
							<motion.div
								key={service.slug}
								variants={fadeUp}
								transition={{ duration: 0.4 }}
							>
								<MachineCard
									name={service.name[lang]}
									description={service.tagline[lang]}
									inputs={service.inputs[lang]}
									outputs={service.outputs[lang]}
								/>
							</motion.div>
						))}
					</ServiceGrid>
				</Section>
			</div>

			{/* ── 4. PROOF ── */}
			<motion.div
				variants={fadeUp}
				initial='hidden'
				whileInView='visible'
				viewport={{ once: true, amount: 0.2 }}
				transition={{ duration: 0.5 }}
			>
				<Section title={t.toolDetail.examples}>
					<ProofGrid
						variants={staggerContainer}
						initial='hidden'
						whileInView='visible'
						viewport={{ once: true, amount: 0.1 }}
					>
						{allExamples.map(ex => (
							<motion.div
								key={ex.industry}
								variants={fadeUp}
								transition={{ duration: 0.4 }}
							>
								<ProofCard>
									<ProofIndustry>{ex.industry}</ProofIndustry>
									<ProofProblem>{ex.problem}</ProofProblem>
									<ProofResult>{ex.result}</ProofResult>
								</ProofCard>
							</motion.div>
						))}
					</ProofGrid>
				</Section>
			</motion.div>

			{/* ── 5. PRICING ── */}
			<motion.div
				ref={pricingRef}
				variants={fadeUp}
				initial='hidden'
				whileInView='visible'
				viewport={{ once: true, amount: 0.2 }}
				transition={{ duration: 0.5 }}
			>
				<Section
					id='pricing'
					title={t.pricing.pageTitle}
					subtitle={t.pricing.pageSubtitle}
				>
					{services.map(service => (
						<PricingBlock key={service.slug}>
							<PricingName>{service.name[lang]}</PricingName>
							<PartsRow
								name={service.name[lang]}
								description={service.tagline[lang]}
								price={service.startingPrice}
								unit={service.priceUnit[lang]}
							/>
							<IncludesGrid>
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
							</IncludesGrid>
						</PricingBlock>
					))}
				</Section>
			</motion.div>

			{/* ── 6. CTA ── */}
			<motion.div
				ref={contactRef}
				variants={fadeUp}
				initial='hidden'
				whileInView='visible'
				viewport={{ once: true, amount: 0.3 }}
				transition={{ duration: 0.5 }}
			>
				<Section id='contact'>
					<ControlPanel
						heading={t.sections.cta}
						body={t.sections.ctaBody}
						primaryLabel={t.sections.ctaPrimary}
						primaryHref='mailto:hola@engranatge.com'
					/>
				</Section>
			</motion.div>
		</>
	)
}
