import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, createLink } from '@tanstack/react-router'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { useSectionRef } from '#/components/layout/active-section-context'
import { Section } from '#/components/layout/section'
import { workshopButtonStyles } from '#/components/layout/workshop-button'
import { BeforeAfter } from '#/components/workshop/before-after'
import { ControlPanel } from '#/components/workshop/control-panel'
import { ConveyorBelt } from '#/components/workshop/conveyor-belt'
import { MachineCard } from '#/components/workshop/machine-card'
import { scatter } from '#/data/scatter'
import { services } from '#/data/services'
import { isLangCode, type LangCode } from '#/i18n'
import { useLang } from '#/i18n/lang-provider'
import { makeI18n } from '#/i18n/lingui'
import { buildPublicPath, getAlternates } from '#/i18n/slugs'

/* ─── Animation variants ─── */

const fadeUp = {
	hidden: { opacity: 0, y: 20 },
	visible: { opacity: 1, y: 0 },
}

const staggerContainer = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.1 } },
}

export const Route = createFileRoute('/$lang/')({
	component: Home,
	loader: ({ params }) => {
		const lang: LangCode = isLangCode(params.lang) ? params.lang : 'en'
		const i18n = makeI18n(lang)
		return {
			title: i18n._(msg`Engranatge — Machines do the work`),
			description: i18n._(
				msg`We build automations, AI and micro-apps so your business runs itself.`,
			),
		}
	},
	head: ({ params, loaderData }) => {
		const lang: LangCode = isLangCode(params.lang) ? params.lang : 'en'
		const title = loaderData?.title ?? ''
		const description = loaderData?.description ?? ''
		const alternates = getAlternates('home')
		return {
			meta: [
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:url', content: buildPublicPath('home', lang) },
				{ property: 'og:locale', content: lang },
			],
			links: [
				{ rel: 'canonical', href: buildPublicPath('home', lang) },
				...alternates.map(a => ({
					rel: 'alternate',
					hrefLang: a.hrefLang,
					href: a.href,
				})),
				{
					rel: 'alternate',
					hrefLang: 'x-default',
					href: buildPublicPath('home', 'en'),
				},
			],
		}
	},
})

/* ─── Styled components ─── */

const HeroSection = styled.section.withConfig({ displayName: 'HeroSection' })`
	padding: var(--space-5xl) var(--page-gutter) var(--space-4xl);
	max-width: var(--page-max-width);
	margin: 0 auto;

	@media (max-width: 767px) {
		padding-top: var(--space-3xl);
		padding-bottom: var(--space-2xl);
	}
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

const HeroCtaAnchor = styled.a`
	${workshopButtonStyles}
`

const HeroCta = createLink(HeroCtaAnchor)

const ServiceGrid = styled(motion.div).withConfig({
	displayName: 'ServiceGrid',
})`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(3, 1fr);
	}
`

const ProofGrid = styled(motion.div).withConfig({ displayName: 'ProofGrid' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(2, 1fr);
	}
`

/* Index card pinned to the board */
const ProofCard = styled.div.withConfig({ displayName: 'ProofCard' })`
	padding: var(--space-lg);
	padding-top: calc(var(--space-lg) + 6px);
	background:
		linear-gradient(var(--scatter-grad, 160deg), var(--color-metal-light) 0%, var(--color-metal) 50%, var(--color-metal-dark) 100%);
	border: 1px solid var(--color-outline);
	box-shadow:
		var(--scatter-shadow-x, 0px) var(--scatter-shadow-y, 2px) 6px rgba(0, 0, 0, 0.1);
	position: relative;
	transform-origin: top center;
	transform:
		rotate(var(--scatter-rotate, 0deg))
		translate(var(--scatter-dx, 0px), var(--scatter-dy, 0px));
	filter: hue-rotate(var(--scatter-hue, 0deg));
	transition: transform 0.3s ease;

	@media (min-width: 768px) {
		&:hover { transform: rotate(0deg) translate(0px, 0px); }
	}

	/* Pin/tack — offset + color variation by scatter */
	&::before {
		content: '';
		position: absolute;
		top: 6px;
		left: calc(50% + var(--scatter-pin-dx, 0px));
		transform: translateX(-50%);
		width: 10px;
		height: 10px;
		border-radius: var(--shape-full);
		background: radial-gradient(circle at 35% 35%, #D4544A, #A03030);
		border: 1px solid rgba(0, 0, 0, 0.2);
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
		filter: hue-rotate(var(--scatter-pin-hue, 0deg));
	}
`

const ProofIndustry = styled.span`
	display: inline-block;
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
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
	font-weight: var(--font-weight-medium);
	color: var(--color-secondary);
`

const PricingBlock = styled.div.withConfig({ displayName: 'PricingBlock' })`
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
	font-weight: var(--font-weight-bold);
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

/* ─── Page ─── */

function Home() {
	const { t } = useLingui()
	const lang = useLang()
	const heroRef = useSectionRef('hero')
	const solutionRef = useSectionRef('solution')
	const pricingRef = useSectionRef('pricing')
	const contactRef = useSectionRef('contact')

	const beforeAfterItems = [
		{
			before: t`4h copying invoices by hand`,
			after: t`10 min, automated`,
		},
		{
			before: t`Client follow-up in a spreadsheet`,
			after: t`Smart reminders`,
		},
		{
			before: t`Orders via WhatsApp, counted by hand`,
			after: t`Order system with real-time stock`,
		},
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
						<Headline>
							<Trans>Machines do the work. You run the business.</Trans>
						</Headline>
						<Subheadline>
							<Trans>We build tools that work while you sleep.</Trans>
						</Subheadline>
						<motion.div
							style={{ display: 'inline-block' }}
							whileHover={{ scale: 1.03 }}
							whileTap={{ scale: 0.97 }}
							transition={{ type: 'spring', stiffness: 400, damping: 20 }}
						>
							<HeroCta to='/$lang' params={{ lang }} hash='contact'>
								<Trans>Let's talk</Trans>
							</HeroCta>
						</motion.div>
					</HeroText>
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
				<Section id='problem' title={t`Before and after`}>
					<BeforeAfter
						items={beforeAfterItems}
						beforeLabel={t`Without Engranatge`}
						afterLabel={t`With Engranatge`}
					/>
				</Section>
			</motion.div>

			{/* ── 3. SOLUTION ── */}
			<div ref={solutionRef}>
				<Section id='solution' title={t`What we build`}>
					<ServiceGrid
						variants={staggerContainer}
						initial='hidden'
						whileInView='visible'
						viewport={{ once: true, amount: 0.2 }}
					>
						{services.map((service, i) => (
							<motion.div
								key={service.slug}
								variants={fadeUp}
								transition={{ duration: 0.4 }}
								style={scatter(i)}
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
				<Section title={t`Examples`}>
					<ProofGrid
						variants={staggerContainer}
						initial='hidden'
						whileInView='visible'
						viewport={{ once: true, amount: 0.1 }}
					>
						{allExamples.map((ex, i) => (
							<motion.div
								key={ex.industry}
								variants={fadeUp}
								transition={{ duration: 0.4 }}
								style={scatter(i + 3)}
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

			{/* ── 5. WHAT'S INCLUDED ── */}
			<motion.div
				ref={pricingRef}
				variants={fadeUp}
				initial='hidden'
				whileInView='visible'
				viewport={{ once: true, amount: 0.2 }}
				transition={{ duration: 0.5 }}
			>
				<Section id='pricing' title={t`Pricing`} subtitle={t`No fine print.`}>
					{services.map(service => (
						<PricingBlock key={service.slug}>
							<PricingName>{service.name[lang]}</PricingName>
							<IncludesGrid>
								<IncludesColumn>
									<IncludesLabel>
										<Trans>What's included</Trans>
									</IncludesLabel>
									{service.includes[lang].map(item => (
										<IncludesItem key={item} $included>
											{item}
										</IncludesItem>
									))}
								</IncludesColumn>
								<IncludesColumn>
									<IncludesLabel>
										<Trans>What's not included</Trans>
									</IncludesLabel>
									{service.excludes[lang].map(item => (
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
						heading={t`Let's talk about your business`}
						body={t`Tell us what you need and we'll tell you how we can automate it. No strings attached.`}
						primaryLabel={t`Get a quote`}
						primaryHref='mailto:hola@engranatge.com'
					/>
				</Section>
			</motion.div>
		</>
	)
}
