import styled from 'styled-components'

/* Workshop machine nameplate — metal tag hanging from nail on pegboard */
const Card = styled.div.attrs({ 'data-component': 'MachineCard' })`
	background:
		var(--texture-brushed-metal),
		linear-gradient(160deg, var(--color-metal-light) 0%, var(--color-metal) 50%, var(--color-metal-dark) 100%);
	border: 1px solid var(--color-outline);
	padding: var(--space-lg);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	position: relative;
	transform-origin: top center;
	transition: transform 0.3s ease;

	/* Alternating slight rotation — things on pegboards are never straight */
	&:nth-child(1) { transform: rotate(-0.6deg); }
	&:nth-child(2) { transform: rotate(0.4deg); }
	&:nth-child(3) { transform: rotate(-0.3deg); }

	&:hover {
		transform: rotate(0deg);
	}

	/* Top-center nail hole */
	&::before {
		content: '';
		position: absolute;
		top: var(--space-xs);
		left: 50%;
		transform: translateX(-50%);
		width: 8px;
		height: 8px;
		border-radius: var(--shape-full);
		background: radial-gradient(circle at 40% 40%, var(--color-metal-dark), var(--color-metal-deep));
		border: 1px solid rgba(0, 0, 0, 0.2);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
	}
`

const CardHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding-top: var(--space-xs);
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

/* Small stamped metal tag */
const IOItem = styled.li`
	font-size: var(--typescale-body-small-size);
	background:
		linear-gradient(160deg, var(--color-metal) 0%, var(--color-metal-dark) 100%);
	padding: var(--space-3xs) var(--space-xs);
	border: 1px solid rgba(0, 0, 0, 0.1);
	box-shadow: var(--elevation-workshop-sm);
	color: #555045;
	font-weight: 500;
	letter-spacing: 0.02em;
`

export function MachineCard({
	name,
	description,
	inputs,
	outputs,
}: {
	name: string
	description: string
	inputs: string[]
	outputs: string[]
}) {
	return (
		<Card>
			<CardHeader>
				<MachineName>{name}</MachineName>
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
		</Card>
	)
}
