import { Trans } from '@lingui/react/macro'
import styled from 'styled-components'

import { microScatter } from '#/data/scatter'

/* Workshop machine nameplate — metal tag hanging from nail on pegboard */
const Card = styled.div.withConfig({ displayName: 'MachineCard' })`
	background:
		var(--texture-brushed-metal),
		linear-gradient(var(--scatter-grad, 160deg), var(--color-metal-light) 0%, var(--color-metal) 50%, var(--color-metal-dark) 100%);
	border: 1px solid var(--color-outline);
	box-shadow:
		var(--scatter-shadow-x, 0px) var(--scatter-shadow-y, 2px) 6px rgba(0, 0, 0, 0.1);
	padding: var(--space-lg);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	position: relative;
	transform-origin: top center;
	transform:
		rotate(var(--scatter-rotate, 0deg))
		translate(var(--scatter-dx, 0px), var(--scatter-dy, 0px));
	filter: hue-rotate(var(--scatter-hue, 0deg));
	transition: transform 0.3s ease;

	@media (min-width: 768px) {
		&:hover { transform: rotate(0deg) translate(0px, 0px); }
	}

	/* Top-center nail hole — offset by scatter */
	&::before {
		content: '';
		position: absolute;
		top: var(--space-xs);
		left: calc(50% + var(--scatter-pin-dx, 0px));
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
	font-weight: var(--font-weight-medium);
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

/* Small stamped metal tag — micro-rotated via inline --tag-rotate */
const IOItem = styled.li`
	font-size: var(--typescale-body-small-size);
	background:
		linear-gradient(160deg, var(--color-metal) 0%, var(--color-metal-dark) 100%);
	padding: var(--space-3xs) var(--space-xs);
	border: 1px solid rgba(0, 0, 0, 0.1);
	box-shadow: var(--elevation-workshop-sm);
	color: var(--color-on-surface);
	font-weight: var(--font-weight-medium);
	letter-spacing: 0.02em;
	transform: rotate(var(--tag-rotate, 0deg));
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
				<IOLabel>
					<Trans>Input</Trans>
				</IOLabel>
				<IOList>
					{inputs.map((item, i) => (
						<IOItem key={item} style={microScatter(i)}>
							{item}
						</IOItem>
					))}
				</IOList>
			</IOSection>
			<IOSection>
				<IOLabel>
					<Trans>Output</Trans>
				</IOLabel>
				<IOList>
					{outputs.map((item, i) => (
						<IOItem key={item} style={microScatter(i + inputs.length)}>
							{item}
						</IOItem>
					))}
				</IOList>
			</IOSection>
		</Card>
	)
}
