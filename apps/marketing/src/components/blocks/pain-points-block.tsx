import styled from 'styled-components'

import type { PainPointsAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const List = styled.ul`
	list-style: none;
	padding: 0;
	margin: 0;
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);

	@media (min-width: 768px) {
		grid-template-columns: repeat(2, 1fr);
	}
`

const Item = styled.li`
	display: flex;
	gap: var(--space-md);
	padding: var(--space-md);
	background: var(--color-metal-light);
	border-left: 3px solid var(--color-primary);
`

const Icon = styled.span`
	font-size: var(--typescale-headline-small-size);
	line-height: 1;
`

const Title = styled.h3`
	font-size: var(--typescale-title-medium-size);
	color: var(--color-on-surface);
	margin-bottom: var(--space-2xs);
`

const Body = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
`

export function PainPointsBlock({ attrs }: { attrs: PainPointsAttrs }) {
	return (
		<Section title={attrs.heading}>
			<List>
				{attrs.items.map(item => (
					<Item key={item.title}>
						<Icon aria-hidden>{item.icon}</Icon>
						<div>
							<Title>{item.title}</Title>
							<Body>{item.body}</Body>
						</div>
					</Item>
				))}
			</List>
		</Section>
	)
}
