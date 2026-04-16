import styled from 'styled-components'

import type { FaqAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const List = styled.dl`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Question = styled.dt`
	font-size: var(--typescale-title-large-size);
	color: var(--color-on-surface);
	margin-bottom: var(--space-xs);
`

const Answer = styled.dd`
	margin: 0;
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface-variant);
`

export function FaqBlock({ attrs }: { attrs: FaqAttrs }) {
	return (
		<Section title={attrs.heading}>
			<List>
				{attrs.items.map(item => (
					<div key={item.question}>
						<Question>{item.question}</Question>
						<Answer>{item.answer}</Answer>
					</div>
				))}
			</List>
		</Section>
	)
}
