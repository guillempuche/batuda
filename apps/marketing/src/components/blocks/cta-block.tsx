import styled from 'styled-components'

import type { CtaAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'
import { workshopButtonStyles } from '#/components/layout/workshop-button'

const Body = styled.p`
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-xl);
`

const Buttons = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-md);
`

const Primary = styled.a`
	${workshopButtonStyles}
`

const Secondary = styled.a`
	color: var(--color-on-surface);
	text-decoration: underline;
	padding: var(--space-sm) var(--space-md);
`

export function CtaBlock({ attrs }: { attrs: CtaAttrs }) {
	return (
		<Section title={attrs.heading}>
			{attrs.body && <Body>{attrs.body}</Body>}
			<Buttons>
				{attrs.buttons.map((b, i) => {
					const Btn = i === 0 ? Primary : Secondary
					return (
						<Btn key={b.label} href={b.url || b.action}>
							{b.label}
						</Btn>
					)
				})}
			</Buttons>
		</Section>
	)
}
