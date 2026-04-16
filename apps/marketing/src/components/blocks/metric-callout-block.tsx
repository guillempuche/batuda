import styled from 'styled-components'

import type { MetricCalloutAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const Callout = styled.div`
	text-align: center;
	padding: var(--space-2xl) var(--space-lg);
`

const Value = styled.div`
	font-family: var(--font-display);
	font-size: var(--typescale-display-large-size);
	line-height: var(--typescale-display-large-line);
	color: var(--color-primary);
`

const Unit = styled.span`
	font-size: var(--typescale-headline-medium-size);
	color: var(--color-on-surface-variant);
	margin-left: var(--space-sm);
`

const Caption = styled.p`
	margin-top: var(--space-md);
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface-variant);
`

export function MetricCalloutBlock({ attrs }: { attrs: MetricCalloutAttrs }) {
	return (
		<Section>
			<Callout>
				<Value>
					{attrs.value}
					{attrs.unit && <Unit>{attrs.unit}</Unit>}
				</Value>
				{attrs.caption && <Caption>{attrs.caption}</Caption>}
			</Callout>
		</Section>
	)
}
