import { createFileRoute } from '@tanstack/react-router'
import styled from 'styled-components'

import { Section } from '#/components/layout/Section'
import { ControlPanel } from '#/components/workshop/ControlPanel'
import { MachineCard } from '#/components/workshop/MachineCard'
import { services } from '#/data/services'
import { useLang, useTranslations } from '#/i18n/LangProvider'

export const Route = createFileRoute('/tools/')({
	component: ToolsIndex,
})

const Grid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(2, 1fr);
	}

	@media (min-width: 1024px) {
		grid-template-columns: repeat(3, 1fr);
	}
`

function ToolsIndex() {
	const t = useTranslations()
	const lang = useLang()

	return (
		<>
			<Section title={t.tools.pageTitle} subtitle={t.tools.pageSubtitle}>
				<Grid>
					{services.map(service => (
						<MachineCard
							key={service.slug}
							name={service.name[lang]}
							description={service.tagline[lang]}
							inputs={service.inputs[lang]}
							outputs={service.outputs[lang]}
							slug={service.slug}
							buttonLabel={service.name[lang]}
						/>
					))}
				</Grid>
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
