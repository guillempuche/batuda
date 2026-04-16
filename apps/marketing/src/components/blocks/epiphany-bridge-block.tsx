import styled from 'styled-components'

import type { EpiphanyBridgeAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const WayRow = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);
	margin-bottom: var(--space-xl);

	@media (min-width: 768px) {
		grid-template-columns: 1fr 1fr;
	}
`

const WayCard = styled.div<{ $accent?: boolean }>`
	padding: var(--space-md);
	border-left: 3px solid
		${p => (p.$accent ? 'var(--color-primary)' : 'var(--color-outline)')};
	background: var(--color-metal-light);
`

const WayLabel = styled.h4`
	font-size: var(--typescale-label-large-size);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-2xs);
`

const WayText = styled.p`
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface);
`

const Insight = styled.p`
	font-size: var(--typescale-headline-small-size);
	color: var(--color-primary);
	margin-bottom: var(--space-md);
`

const Desire = styled.p`
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-xl);
`

const Beats = styled.ol`
	list-style: none;
	counter-reset: beat;
	padding: 0;
`

const Beat = styled.li`
	counter-increment: beat;
	padding-left: var(--space-xl);
	position: relative;
	margin-bottom: var(--space-md);

	&::before {
		content: counter(beat);
		position: absolute;
		left: 0;
		top: 0;
		font-family: var(--font-display);
		font-size: var(--typescale-headline-small-size);
		color: var(--color-primary);
	}
`

const BeatHeading = styled.h4`
	font-size: var(--typescale-title-medium-size);
	color: var(--color-on-surface);
	margin-bottom: var(--space-2xs);
`

const BeatBody = styled.p`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
`

export function EpiphanyBridgeBlock({ attrs }: { attrs: EpiphanyBridgeAttrs }) {
	return (
		<Section>
			<WayRow>
				<WayCard>
					<WayLabel>Before</WayLabel>
					<WayText>{attrs.oldWay}</WayText>
				</WayCard>
				<WayCard $accent>
					<WayLabel>After</WayLabel>
					<WayText>{attrs.newWay}</WayText>
				</WayCard>
			</WayRow>
			{attrs.insight && <Insight>{attrs.insight}</Insight>}
			{attrs.desire && <Desire>{attrs.desire}</Desire>}
			{attrs.beats.length > 0 && (
				<Beats>
					{attrs.beats.map(beat => (
						<Beat key={beat.heading}>
							<BeatHeading>{beat.heading}</BeatHeading>
							<BeatBody>{beat.body}</BeatBody>
						</Beat>
					))}
				</Beats>
			)}
		</Section>
	)
}
