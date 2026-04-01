import { createFileRoute, Link } from '@tanstack/react-router'
import styled from 'styled-components'

import { Section } from '#/components/layout/Section'
import { BeforeAfter } from '#/components/workshop/BeforeAfter'
import { ControlPanel } from '#/components/workshop/ControlPanel'
import { ConveyorBelt } from '#/components/workshop/ConveyorBelt'
import { GearMascot } from '#/components/workshop/GearMascot'
import { MachineCard } from '#/components/workshop/MachineCard'
import { services } from '#/data/services'
import { useLang, useTranslations } from '#/i18n/LangProvider'

export const Route = createFileRoute('/')({
	component: Home,
})

const HeroSection = styled.section`
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
	font-family: 'DM Sans', system-ui, sans-serif;
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
	background: var(--color-primary);
	color: var(--color-on-primary);
	border-radius: var(--shape-xs);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	text-decoration: none;
	transition: filter 0.15s;

	&:hover {
		filter: brightness(0.9);
	}
`

const ServiceGrid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 1024px) {
		grid-template-columns: repeat(3, 1fr);
	}
`

const SectionLink = styled(Link)`
	display: block;
	margin-top: var(--space-xl);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	color: var(--color-primary);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
`

function Home() {
	const t = useTranslations()
	const lang = useLang()

	const beforeAfterItems = [
		t.beforeAfter.invoices,
		t.beforeAfter.followUp,
		t.beforeAfter.orders,
	]

	const conveyorItems = beforeAfterItems.map(item => ({
		before: item.before,
		after: item.after,
	}))

	return (
		<>
			<HeroSection>
				<HeroContent>
					<HeroText>
						<Headline>{t.hero.headline}</Headline>
						<Subheadline>{t.hero.subheadline}</Subheadline>
						<HeroCta to='/pricing'>{t.hero.cta}</HeroCta>
					</HeroText>
					<GearMascot expression='default' size={120} />
				</HeroContent>
			</HeroSection>

			<ConveyorBelt items={conveyorItems} />

			<Section title={t.sections.services}>
				<ServiceGrid>
					{services.map(service => (
						<MachineCard
							key={service.slug}
							name={service.name[lang]}
							description={service.tagline[lang]}
							inputs={service.inputs[lang]}
							outputs={service.outputs[lang]}
							slug={service.slug}
							buttonLabel={t.sections.services}
						/>
					))}
				</ServiceGrid>
				<SectionLink to='/tools'>{t.sections.servicesLink}</SectionLink>
			</Section>

			<Section title={t.sections.beforeAfter}>
				<BeforeAfter
					items={beforeAfterItems}
					beforeLabel={t.sections.beforeLabel}
					afterLabel={t.sections.afterLabel}
				/>
			</Section>

			<Section>
				<ControlPanel
					heading={t.sections.cta}
					body={t.sections.ctaBody}
					primaryLabel={t.sections.ctaPrimary}
					primaryTo='/pricing'
					secondaryLabel={t.sections.ctaSecondary}
					secondaryHref='mailto:hola@engranatge.com'
				/>
			</Section>
		</>
	)
}
