import styled from 'styled-components'

import type { SocialProofAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const Grid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(2, 1fr);
	}
`

const Card = styled.blockquote`
	margin: 0;
	padding: var(--space-lg);
	background: var(--color-metal-light);
	border: 1px solid var(--color-outline);
`

const Quote = styled.p`
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-md);

	&::before {
		content: '\u201C';
	}
	&::after {
		content: '\u201D';
	}
`

const Attribution = styled.footer`
	font-size: var(--typescale-label-large-size);
	color: var(--color-on-surface-variant);
`

export function SocialProofBlock({ attrs }: { attrs: SocialProofAttrs }) {
	return (
		<Section title={attrs.heading}>
			<Grid>
				{attrs.testimonials.map(t => (
					<Card key={`${t.author}-${t.company}`}>
						<Quote>{t.quote}</Quote>
						<Attribution>
							{t.author}, {t.company}
						</Attribution>
					</Card>
				))}
			</Grid>
		</Section>
	)
}
