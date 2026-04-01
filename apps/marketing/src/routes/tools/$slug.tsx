import { createFileRoute, notFound } from '@tanstack/react-router'
import styled from 'styled-components'

import { Section } from '#/components/layout/Section'
import { ControlPanel } from '#/components/workshop/ControlPanel'
import { IndicatorLight } from '#/components/workshop/IndicatorLight'
import { getServiceBySlug } from '#/data/services'
import { useLang, useTranslations } from '#/i18n/LangProvider'

export const Route = createFileRoute('/tools/$slug')({
	component: ToolDetail,
	loader: ({ params }) => {
		const service = getServiceBySlug(params.slug)
		if (!service) throw notFound()
		return { service }
	},
})

const Hero = styled.div`
	padding: var(--space-4xl) var(--page-gutter) var(--space-2xl);
	max-width: var(--page-max-width);
	margin: 0 auto;
`

const HeroHeader = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	margin-bottom: var(--space-sm);
`

const Title = styled.h1`
	font-family: 'DM Sans', system-ui, sans-serif;
	font-size: var(--typescale-display-small-size);
	line-height: var(--typescale-display-small-line);
	color: var(--color-on-surface);
`

const Tagline = styled.p`
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	color: var(--color-on-surface-variant);
`

const Description = styled.p`
	font-size: var(--typescale-body-large-size);
	line-height: 1.7;
	color: var(--color-on-surface);
	max-width: 40rem;
`

const IOGrid = styled.div`
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--space-lg);

	@media (max-width: 767px) {
		grid-template-columns: 1fr;
	}
`

const IOColumn = styled.div`
	background: var(--color-surface-container-low);
	border-radius: var(--shape-sm);
	padding: var(--space-lg);
`

const IOLabel = styled.h3`
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	letter-spacing: var(--typescale-label-large-tracking);
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-sm);
`

const IOList = styled.ul`
	list-style: none;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
`

const IOItem = styled.li`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	padding-left: var(--space-md);
	position: relative;

	&::before {
		content: '→';
		position: absolute;
		left: 0;
		color: var(--color-primary);
	}
`

const ExampleCard = styled.div`
	background: var(--color-surface-container-lowest);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-sm);
	padding: var(--space-lg);
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
`

const ExampleIndustry = styled.span`
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--typescale-label-medium-weight);
	color: var(--color-primary);
	text-transform: uppercase;
	letter-spacing: var(--typescale-label-medium-tracking);
`

const ExampleProblem = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
`

const ExampleSolution = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	font-weight: 500;
`

const ExampleResult = styled.span`
	font-size: var(--typescale-title-medium-size);
	font-weight: var(--typescale-title-medium-weight);
	color: var(--color-secondary);
`

const ExamplesGrid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(2, 1fr);
	}
`

function ToolDetail() {
	const { service } = Route.useLoaderData()
	const t = useTranslations()
	const lang = useLang()

	return (
		<>
			<Hero>
				<HeroHeader>
					<Title>{service.name[lang]}</Title>
					<IndicatorLight color='green' />
				</HeroHeader>
				<Tagline>{service.tagline[lang]}</Tagline>
			</Hero>

			<Section>
				<Description>{service.description[lang]}</Description>
			</Section>

			<Section>
				<IOGrid>
					<IOColumn>
						<IOLabel>{t.toolDetail.inputs}</IOLabel>
						<IOList>
							{service.inputs[lang].map(item => (
								<IOItem key={item}>{item}</IOItem>
							))}
						</IOList>
					</IOColumn>
					<IOColumn>
						<IOLabel>{t.toolDetail.outputs}</IOLabel>
						<IOList>
							{service.outputs[lang].map(item => (
								<IOItem key={item}>{item}</IOItem>
							))}
						</IOList>
					</IOColumn>
				</IOGrid>
			</Section>

			<Section title={t.toolDetail.examples}>
				<ExamplesGrid>
					{service.examples[lang].map(example => (
						<ExampleCard key={example.industry}>
							<ExampleIndustry>{example.industry}</ExampleIndustry>
							<ExampleProblem>{example.problem}</ExampleProblem>
							<ExampleSolution>{example.solution}</ExampleSolution>
							<ExampleResult>{example.result}</ExampleResult>
						</ExampleCard>
					))}
				</ExamplesGrid>
			</Section>

			<Section>
				<ControlPanel
					heading={t.toolDetail.cta}
					body={t.toolDetail.ctaBody}
					primaryLabel={t.sections.ctaPrimary}
					primaryTo='/pricing'
					secondaryLabel={t.sections.ctaSecondary}
					secondaryHref='mailto:hola@engranatge.com'
				/>
			</Section>
		</>
	)
}
