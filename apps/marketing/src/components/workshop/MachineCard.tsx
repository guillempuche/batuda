import { Link } from '@tanstack/react-router'
import styled from 'styled-components'

import { IndicatorLight } from './IndicatorLight'

const Card = styled.div`
	background: var(--color-surface-container-low);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-sm);
	padding: var(--space-lg);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	transition: box-shadow 0.2s;

	&:hover {
		box-shadow: var(--elevation-md);
	}
`

const CardHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
`

const MachineName = styled.h3`
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	font-weight: 500;
	color: var(--color-on-surface);
`

const Description = styled.p`
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
`

const IOSection = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const IOLabel = styled.span`
	font-size: var(--typescale-label-small-size);
	font-weight: var(--typescale-label-small-weight);
	letter-spacing: var(--typescale-label-small-tracking);
	color: var(--color-on-surface-variant);
	text-transform: uppercase;
`

const IOList = styled.ul`
	list-style: none;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const IOItem = styled.li`
	font-size: var(--typescale-body-small-size);
	background: var(--color-surface-container);
	padding: var(--space-3xs) var(--space-xs);
	border-radius: var(--shape-full);
	color: var(--color-on-surface-variant);
`

const CardButton = styled(Link)`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: var(--space-xs) var(--space-lg);
	background: var(--color-primary);
	color: var(--color-on-primary);
	border-radius: var(--shape-xs);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	text-decoration: none;
	transition: filter 0.15s;
	align-self: flex-start;

	&:hover {
		filter: brightness(0.9);
	}
`

export function MachineCard({
	name,
	description,
	inputs,
	outputs,
	slug,
	buttonLabel,
}: {
	name: string
	description: string
	inputs: string[]
	outputs: string[]
	slug: string
	buttonLabel: string
}) {
	return (
		<Card>
			<CardHeader>
				<MachineName>{name}</MachineName>
				<IndicatorLight color='green' />
			</CardHeader>
			<Description>{description}</Description>
			<IOSection>
				<IOLabel>Entrada</IOLabel>
				<IOList>
					{inputs.map(item => (
						<IOItem key={item}>{item}</IOItem>
					))}
				</IOList>
			</IOSection>
			<IOSection>
				<IOLabel>Sortida</IOLabel>
				<IOList>
					{outputs.map(item => (
						<IOItem key={item}>{item}</IOItem>
					))}
				</IOList>
			</IOSection>
			<CardButton to='/tools/$slug' params={{ slug }}>
				{buttonLabel}
			</CardButton>
		</Card>
	)
}
