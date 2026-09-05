import { useInView } from 'motion/react'
import { AnimateNumber } from 'motion-plus/react'
import { styled } from 'next-yak'
import { useRef } from 'react'

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
 *
 * `density='compact'` keeps the plate and its digits but takes far less height,
 * for a screen showing several at once. At full size four of these fill a phone
 * for more than a screen and a short laptop almost entirely, which pushes
 * everything worth acting on below the fold.
 */
export function KpiCounter({
	value,
	label,
	suffix,
	density = 'comfortable',
}: {
	value: number
	label: string
	suffix?: string
	density?: 'comfortable' | 'compact'
}) {
	const ref = useRef<HTMLDivElement>(null)
	const inView = useInView(ref, { once: true, amount: 0.4 })
	return (
		<MetalPlate ref={ref} $compact={density === 'compact'}>
			<ScrewDot data-position='top-left' $size={6} aria-hidden />
			<ScrewDot data-position='top-right' $size={6} aria-hidden />
			<ScrewDot data-position='bottom-left' $size={6} aria-hidden />
			<ScrewDot data-position='bottom-right' $size={6} aria-hidden />
			<Digits $compact={density === 'compact'}>
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

const MetalPlate = styled.div<{ $compact?: boolean }>`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: ${p => (p.$compact ? 'var(--space-3xs)' : 'var(--space-xs)')};
	padding: ${p =>
		p.$compact
			? 'var(--space-sm) var(--space-md)'
			: 'var(--space-lg) var(--space-lg) var(--space-md)'};
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-md);
	min-width: 0;
`

const Digits = styled.div<{ $compact?: boolean }>`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-3xs);
	font-family: var(--font-display);
	font-size: ${p =>
		p.$compact ? 'clamp(1.5rem, 3.5vw, 2rem)' : 'clamp(2.5rem, 6vw, 4rem)'};
	font-weight: var(--font-weight-bold);
	line-height: 1;
	letter-spacing: 0.02em;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-engrave);
	font-variant-numeric: tabular-nums;
`

const Suffix = styled.span`
	font-size: 0.55em;
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface-variant);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const Label = styled.p`
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
