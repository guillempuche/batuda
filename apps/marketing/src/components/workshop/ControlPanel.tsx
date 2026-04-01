import { Link } from '@tanstack/react-router'
import styled from 'styled-components'

import { IndicatorLight } from './IndicatorLight'

const Panel = styled.div`
	background: var(--color-surface-container-high);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-sm);
	padding: var(--space-2xl);
`

const LightRow = styled.div`
	display: flex;
	gap: var(--space-xs);
	margin-bottom: var(--space-lg);
`

const Heading = styled.h2`
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-xs);
`

const Body = styled.p`
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-xl);
`

const Actions = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
`

const PrimaryButton = styled(Link)`
	display: inline-flex;
	align-items: center;
	padding: var(--space-sm) var(--space-xl);
	background: var(--color-primary);
	color: var(--color-on-primary);
	border-radius: var(--shape-xs);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	text-decoration: none;
	transition: filter 0.15s;

	&:hover {
		filter: brightness(0.9);
	}
`

const SecondaryButton = styled.a`
	display: inline-flex;
	align-items: center;
	padding: var(--space-sm) var(--space-xl);
	background: transparent;
	color: var(--color-primary);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-xs);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	text-decoration: none;
	transition: border-color 0.15s;

	&:hover {
		border-color: var(--color-primary);
	}
`

export function ControlPanel({
	heading,
	body,
	primaryLabel,
	primaryTo,
	secondaryLabel,
	secondaryHref,
}: {
	heading: string
	body: string
	primaryLabel: string
	primaryTo: string
	secondaryLabel?: string
	secondaryHref?: string
}) {
	return (
		<Panel>
			<LightRow>
				<IndicatorLight color='red' />
				<IndicatorLight color='amber' />
				<IndicatorLight color='green' />
			</LightRow>
			<Heading>{heading}</Heading>
			<Body>{body}</Body>
			<Actions>
				<PrimaryButton to={primaryTo}>{primaryLabel}</PrimaryButton>
				{secondaryLabel && secondaryHref && (
					<SecondaryButton href={secondaryHref}>
						{secondaryLabel}
					</SecondaryButton>
				)}
			</Actions>
		</Panel>
	)
}
