import styled from 'styled-components'

import type { ValuePropsAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const Grid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(3, 1fr);
	}
`

const Card = styled.article`
	padding: var(--space-lg);
	background: var(--color-metal-light);
	border: 1px solid var(--color-outline);
`

const CardTitle = styled.h3`
	font-size: var(--typescale-title-large-size);
	color: var(--color-on-surface);
	margin-bottom: var(--space-sm);
`

const CardBody = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
`

export function ValuePropsBlock({ attrs }: { attrs: ValuePropsAttrs }) {
	return (
		<Section title={attrs.heading}>
			<Grid>
				{attrs.items.map(item => (
					<Card key={item.title}>
						<CardTitle>{item.title}</CardTitle>
						<CardBody>{item.body}</CardBody>
					</Card>
				))}
			</Grid>
		</Section>
	)
}
