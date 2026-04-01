import styled, { keyframes } from 'styled-components'

interface ConveyorItem {
	before: string
	after: string
}

const slide = keyframes`
	0% { transform: translateX(0); }
	100% { transform: translateX(-50%); }
`

const Belt = styled.div`
	position: relative;
	overflow: hidden;
	border-top: 2px dashed var(--color-outline-variant);
	border-bottom: 2px dashed var(--color-outline-variant);
	padding: var(--space-lg) 0;

	@media (max-width: 767px) {
		border-top: none;
		border-bottom: none;
		border-left: 2px dashed var(--color-outline-variant);
		padding: 0 0 0 var(--space-lg);
	}
`

const Track = styled.div`
	display: flex;
	gap: var(--space-xl);
	animation: ${slide} 20s linear infinite;

	@media (prefers-reduced-motion: reduce) {
		animation: none;
	}

	@media (max-width: 767px) {
		flex-direction: column;
		animation: none;
	}
`

const ItemCard = styled.div`
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	background: var(--color-surface-container-low);
	border-radius: var(--shape-sm);

	@media (max-width: 767px) {
		flex-direction: column;
		align-items: flex-start;
	}
`

const Before = styled.span`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	text-decoration: line-through;
`

const Arrow = styled.span`
	color: var(--color-primary);
	font-weight: 700;

	@media (max-width: 767px) {
		transform: rotate(90deg);
	}
`

const After = styled.span`
	font-size: var(--typescale-body-medium-size);
	font-weight: 500;
	color: var(--color-secondary);
`

export function ConveyorBelt({ items }: { items: ConveyorItem[] }) {
	const doubled = [
		...items.map((item, i) => ({ ...item, key: `a-${i}` })),
		...items.map((item, i) => ({ ...item, key: `b-${i}` })),
	]

	return (
		<Belt>
			<Track>
				{doubled.map(item => (
					<ItemCard key={item.key}>
						<Before>{item.before}</Before>
						<Arrow>&rarr;</Arrow>
						<After>{item.after}</After>
					</ItemCard>
				))}
			</Track>
		</Belt>
	)
}
