import { Fragment } from 'react'
import styled from 'styled-components'

interface ComparisonItem {
	before: string
	after: string
}

const Table = styled.div.attrs({ 'data-component': 'BeforeAfter' })`
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 1px;
	background: var(--color-outline-variant);
	border-radius: var(--shape-sm);
	overflow: hidden;

	@media (max-width: 767px) {
		grid-template-columns: 1fr;
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
	font-weight: ${p => (p.$variant === 'after' ? '500' : '400')};
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
				</Fragment>
			))}
		</Table>
	)
}
