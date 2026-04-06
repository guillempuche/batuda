import { Ticker } from 'motion-plus/react'
import styled from 'styled-components'

interface ConveyorItem {
	before: string
	after: string
}

const Belt = styled.div.attrs({ 'data-component': 'ConveyorBelt' })`
	position: relative;
	border-top: 2px dashed var(--color-outline-variant);
	border-bottom: 2px dashed var(--color-outline-variant);
	padding: var(--space-md) 0;

	@media (max-width: 767px) {
		border-top: none;
		border-bottom: none;
		border-left: 2px dashed var(--color-outline-variant);
		padding: var(--space-md) 0 var(--space-md) var(--space-lg);
		overflow-x: auto;
	}
`

const ItemCard = styled.div`
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	background:
		linear-gradient(160deg, var(--color-metal-light) 0%, var(--color-metal-light) 50%, var(--color-metal) 100%);
	border: 1px solid var(--color-outline);
	white-space: nowrap;
`

const Before = styled.span`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	text-decoration: line-through;
`

const Arrow = styled.span`
	color: var(--color-primary);
	font-weight: 700;
`

const After = styled.span`
	font-size: var(--typescale-body-medium-size);
	font-weight: 500;
	color: var(--color-secondary);
`

export function ConveyorBelt({ items }: { items: ConveyorItem[] }) {
	const tickerItems = items.map(item => (
		<ItemCard key={item.before}>
			<Before>{item.before}</Before>
			<Arrow>&rarr;</Arrow>
			<After>{item.after}</After>
		</ItemCard>
	))

	return (
		<Belt>
			<Ticker items={tickerItems} velocity={40} gap={16} hoverFactor={0.3} />
		</Belt>
	)
}
