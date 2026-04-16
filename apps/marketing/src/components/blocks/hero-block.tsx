import styled from 'styled-components'

import type { HeroAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'
import { workshopButtonStyles } from '#/components/layout/workshop-button'

const Heading = styled.h1`
	font-family: var(--font-display);
	font-size: var(--typescale-display-large-size);
	line-height: var(--typescale-display-large-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-md);
`

const Subheading = styled.p`
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-xl);
`

const CtaAnchor = styled.a`
	${workshopButtonStyles}
`

export function HeroBlock({ attrs }: { attrs: HeroAttrs }) {
	return (
		<Section>
			<Heading>{attrs.heading}</Heading>
			{attrs.subheading && <Subheading>{attrs.subheading}</Subheading>}
			{attrs.cta.label && (
				<CtaAnchor href={attrs.cta.action}>{attrs.cta.label}</CtaAnchor>
			)}
		</Section>
	)
}
