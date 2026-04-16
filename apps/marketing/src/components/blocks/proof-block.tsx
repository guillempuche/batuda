import styled from 'styled-components'

import type { ProofAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const Grid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 768px) {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}
`

const Metric = styled.div`
	text-align: center;
	padding: var(--space-lg);
`

const Value = styled.div`
	font-family: var(--font-display);
	font-size: var(--typescale-display-medium-size);
	line-height: var(--typescale-display-medium-line);
	color: var(--color-primary);
	margin-bottom: var(--space-2xs);
`

const Unit = styled.span`
	font-size: var(--typescale-headline-small-size);
	color: var(--color-on-surface-variant);
	margin-left: var(--space-2xs);
`

const Label = styled.div`
	font-size: var(--typescale-label-large-size);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
`

export function ProofBlock({ attrs }: { attrs: ProofAttrs }) {
	return (
		<Section title={attrs.heading}>
			<Grid>
				{attrs.metrics.map(m => (
					<Metric key={m.label}>
						<Value>
							{m.humanValue}
							{m.unit && <Unit>{m.unit}</Unit>}
						</Value>
						<Label>{m.label}</Label>
					</Metric>
				))}
			</Grid>
		</Section>
	)
}
