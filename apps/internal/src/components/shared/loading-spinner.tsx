import { useLingui } from '@lingui/react/macro'
import { Cog } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Typewriter } from 'motion-plus/react'
import styled from 'styled-components'

/**
 * Workshop-flavored busy indicator. A `Cog` icon spins in primary
 * terracotta; when a label is provided it types out beneath the cog
 * using the `Typewriter` primitive, so the "loading…" text reads as
 * if someone is stamping it onto the paper. Respects `prefers-reduced-
 * motion` — the cog freezes and the label renders plain.
 */
export function LoadingSpinner({
	size = 'md',
	label,
}: {
	size?: 'sm' | 'md' | 'lg'
	label?: string
}) {
	const reduced = useReducedMotion()
	const { t } = useLingui()
	const resolvedLabel = label ?? t`Loading…`
	const cogStyle = { display: 'inline-flex', color: 'var(--color-primary)' }
	return (
		<Wrapper role='status' aria-label={resolvedLabel}>
			{reduced ? (
				<span style={cogStyle}>
					<Cog size={sizeMap[size]} aria-hidden />
				</span>
			) : (
				<motion.div
					animate={{ rotate: 360 }}
					transition={{ repeat: Infinity, duration: 2.2, ease: 'linear' }}
					style={cogStyle}
				>
					<Cog size={sizeMap[size]} aria-hidden />
				</motion.div>
			)}
			<Label>
				{reduced ? resolvedLabel : <Typewriter>{resolvedLabel}</Typewriter>}
			</Label>
		</Wrapper>
	)
}

const sizeMap = { sm: 16, md: 28, lg: 40 } as const

const Wrapper = styled.div.withConfig({ displayName: 'LoadingSpinnerWrapper' })`
	display: inline-flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-xs);
`

const Label = styled.span.withConfig({ displayName: 'LoadingSpinnerLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: 0.08em;
	font-weight: var(--font-weight-bold);
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-shadow: var(--text-shadow-emboss);
`
