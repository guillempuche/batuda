import { Fragment } from 'react'
import styled from 'styled-components'

interface ComparisonItem {
	before: string
	after: string
}

/* Two-column comparison table on tablet+; on phone the columns flatten into
 * stacked pair-cards so the before↔after relationship is preserved. */
const Table = styled.div.withConfig({ displayName: 'BeforeAfter' })`
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 1px;
	background: var(--color-outline-variant);
	border-radius: var(--shape-sm);
	overflow: hidden;

	@media (max-width: 767px) {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		background: transparent;
		border-radius: 0;
		overflow: visible;
	}
`

const ColumnHeader = styled.div<{ $variant: 'before' | 'after' }>`
	padding: var(--space-sm) var(--space-md);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	letter-spacing: var(--typescale-label-large-tracking);
	text-transform: uppercase;
	background: ${p =>
		p.$variant === 'before'
			? 'var(--color-surface-dim)'
			: 'var(--color-secondary-container)'};
	color: ${p =>
		p.$variant === 'before'
			? 'var(--color-on-surface-variant)'
			: 'var(--color-on-secondary-container)'};

	@media (max-width: 767px) {
		display: none;
	}
`

const Cell = styled.div<{ $variant: 'before' | 'after' }>`
	padding: var(--space-sm) var(--space-md);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	background: ${p =>
		p.$variant === 'before'
			? 'var(--color-surface-dim)'
			: 'var(--color-secondary-container)'};
	color: ${p =>
		p.$variant === 'before'
			? 'var(--color-on-surface-variant)'
			: 'var(--color-on-secondary-container)'};
	text-decoration: ${p => (p.$variant === 'before' ? 'line-through' : 'none')};
	font-weight: ${p =>
		p.$variant === 'after'
			? 'var(--font-weight-medium)'
			: 'var(--font-weight-regular)'};

	@media (max-width: 767px) {
		display: none;
	}
`

/* Mobile-only stacked card. Each pair gets its own bordered group with
 * inline labels so the before/after relationship is unambiguous. */
const PairCard = styled.div`
	display: none;

	@media (max-width: 767px) {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2xs) var(--space-sm);
		align-items: baseline;
		padding: var(--space-sm) var(--space-md);
		border: 1px solid var(--color-outline-variant);
		border-radius: var(--shape-sm);
		background: var(--color-surface-dim);
	}
`

const PairLabel = styled.span<{ $variant: 'before' | 'after' }>`
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: ${p =>
		p.$variant === 'before'
			? 'var(--color-on-surface-variant)'
			: 'var(--color-secondary)'};
`

const PairValue = styled.span<{ $variant: 'before' | 'after' }>`
	font-size: var(--typescale-body-medium-size);
	color: ${p =>
		p.$variant === 'before'
			? 'var(--color-on-surface-variant)'
			: 'var(--color-on-secondary-container)'};
	text-decoration: ${p => (p.$variant === 'before' ? 'line-through' : 'none')};
	font-weight: ${p =>
		p.$variant === 'after'
			? 'var(--font-weight-medium)'
			: 'var(--font-weight-regular)'};
`

export function BeforeAfter({
	items,
	beforeLabel,
	afterLabel,
}: {
	items: ComparisonItem[]
	beforeLabel: string
	afterLabel: string
}) {
	return (
		<Table>
			<ColumnHeader $variant='before'>{beforeLabel}</ColumnHeader>
			<ColumnHeader $variant='after'>{afterLabel}</ColumnHeader>
			{items.map(item => (
				<Fragment key={item.before}>
					<Cell $variant='before'>{item.before}</Cell>
					<Cell $variant='after'>{item.after}</Cell>
					<PairCard>
						<PairLabel $variant='before'>{beforeLabel}</PairLabel>
						<PairValue $variant='before'>{item.before}</PairValue>
						<PairLabel $variant='after'>{afterLabel}</PairLabel>
						<PairValue $variant='after'>{item.after}</PairValue>
					</PairCard>
				</Fragment>
			))}
		</Table>
	)
}
