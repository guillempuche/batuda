import styled from 'styled-components'

import type { FalseBeliefBreakAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const List = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);
`

const Row = styled.article`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);
	padding: var(--space-md);
	background: var(--color-metal-light);

	@media (min-width: 768px) {
		grid-template-columns: 1fr 1fr;
	}
`

const Kind = styled.span`
	display: inline-block;
	font-size: var(--typescale-label-small-size);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--color-primary);
	margin-bottom: var(--space-2xs);
`

const Thinks = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const Counter = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	font-weight: var(--font-weight-medium);
`

export function FalseBeliefBreakBlock({
	attrs,
}: {
	attrs: FalseBeliefBreakAttrs
}) {
	return (
		<Section title={attrs.heading}>
			<List>
				{attrs.beliefs.map(b => (
					<Row key={b.readerThinks}>
						<div>
							<Kind>{b.kind}</Kind>
							<Thinks>{b.readerThinks}</Thinks>
						</div>
						<Counter>{b.counter}</Counter>
					</Row>
				))}
			</List>
		</Section>
	)
}
