import styled from 'styled-components'

import type { RiskReversalAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const Body = styled.p`
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-lg);
`

const Guarantees = styled.ul`
	list-style: none;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Guarantee = styled.li`
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface);
	padding-left: var(--space-xl);
	position: relative;

	&::before {
		content: '\u2713';
		position: absolute;
		left: 0;
		color: var(--color-secondary);
		font-weight: var(--font-weight-bold);
	}
`

export function RiskReversalBlock({ attrs }: { attrs: RiskReversalAttrs }) {
	return (
		<Section title={attrs.heading}>
			{attrs.body && <Body>{attrs.body}</Body>}
			{attrs.guarantees.length > 0 && (
				<Guarantees>
					{attrs.guarantees.map(g => (
						<Guarantee key={g}>{g}</Guarantee>
					))}
				</Guarantees>
			)}
		</Section>
	)
}
