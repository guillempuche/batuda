import { useInView } from 'motion/react'
import { AnimateNumber } from 'motion-plus/react'
import { useRef } from 'react'
import styled from 'styled-components'

import { ScrewDot } from '#/components/shared/workshop-decorations'
import { brushedMetalPlate } from '#/lib/workshop-mixins'

/**
 * Mechanical-counter KPI tile. Brushed-metal plate with screw dots in the
 * corners and very-large embossed digits in the display typeface. The
 * `AnimateNumber` from motion-plus rolls the digits up from 0 to `value`
 * when the plate first enters the viewport, mimicking a workshop tally
 * counter flipping through numbers.
 *
 * Used sparingly — only for dashboard hero KPIs and list-intro totals.
 */
export function KpiCounter({
	value,
	label,
	suffix,
}: {
	value: number
	label: string
	suffix?: string
}) {
	const ref = useRef<HTMLDivElement>(null)
	const inView = useInView(ref, { once: true, amount: 0.4 })
	return (
		<MetalPlate ref={ref}>
			<ScrewDot $position='top-left' $size={6} aria-hidden />
			<ScrewDot $position='top-right' $size={6} aria-hidden />
			<ScrewDot $position='bottom-left' $size={6} aria-hidden />
			<ScrewDot $position='bottom-right' $size={6} aria-hidden />
			<Digits>
				<AnimateNumber
					format={{ useGrouping: true }}
					transition={{
						y: { type: 'spring', duration: 1.2, bounce: 0 },
						opacity: { duration: 0.8 },
					}}
				>
					{inView ? value : 0}
				</AnimateNumber>
				{suffix && <Suffix>{suffix}</Suffix>}
			</Digits>
			<Label>{label}</Label>
		</MetalPlate>
	)
}

const MetalPlate = styled.div.withConfig({ displayName: 'KpiCounterPlate' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	padding: var(--space-lg) var(--space-lg) var(--space-md);
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-md);
	min-width: 0;
`

const Digits = styled.div.withConfig({ displayName: 'KpiCounterDigits' })`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-3xs);
	font-family: var(--font-display);
	font-size: clamp(2.5rem, 6vw, 4rem);
	font-weight: var(--font-weight-bold);
	line-height: 1;
	letter-spacing: 0.02em;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-engrave);
	font-variant-numeric: tabular-nums;
`

const Suffix = styled.span.withConfig({ displayName: 'KpiCounterSuffix' })`
	font-size: 0.55em;
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface-variant);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const Label = styled.p.withConfig({ displayName: 'KpiCounterLabel' })`
	margin: 0;
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: 0.14em;
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-shadow: var(--text-shadow-emboss);
`
