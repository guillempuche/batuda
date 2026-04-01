import styled from 'styled-components'

const Row = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	padding: var(--space-md) 0;
	border-bottom: 1px solid var(--color-outline-variant);
	gap: var(--space-md);

	&:last-child {
		border-bottom: none;
	}
`

const Info = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const Name = styled.span`
	font-size: var(--typescale-body-large-size);
	font-weight: 500;
	color: var(--color-on-surface);
`

const Description = styled.span`
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const PriceGroup = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	flex-shrink: 0;
`

const Price = styled.span`
	font-size: var(--typescale-title-medium-size);
	font-weight: var(--typescale-title-medium-weight);
	color: var(--color-on-surface);
`

const Unit = styled.span`
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

export function PartsRow({
	name,
	description,
	price,
	unit,
}: {
	name: string
	description?: string
	price: string
	unit?: string
}) {
	return (
		<Row>
			<Info>
				<Name>{name}</Name>
				{description && <Description>{description}</Description>}
			</Info>
			<PriceGroup>
				<Price>{price}</Price>
				{unit && <Unit>{unit}</Unit>}
			</PriceGroup>
		</Row>
	)
}
