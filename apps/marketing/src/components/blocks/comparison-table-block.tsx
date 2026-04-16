import styled from 'styled-components'

import type { ComparisonTableAttrs } from '@engranatge/ui/blocks'

import { Section } from '#/components/layout/section'

const Table = styled.table`
	width: 100%;
	border-collapse: collapse;
`

const Head = styled.th`
	padding: var(--space-md);
	text-align: left;
	font-size: var(--typescale-label-large-size);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
	border-bottom: 2px solid var(--color-outline);
`

const Cell = styled.td`
	padding: var(--space-md);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	border-bottom: 1px solid var(--color-outline);
	vertical-align: top;
`

export function ComparisonTableBlock({
	attrs,
}: {
	attrs: ComparisonTableAttrs
}) {
	return (
		<Section title={attrs.heading}>
			<Table>
				<thead>
					<tr>
						<Head>{attrs.leftLabel}</Head>
						<Head>{attrs.rightLabel}</Head>
					</tr>
				</thead>
				<tbody>
					{attrs.rows.map(row => (
						<tr key={`${row.left}-${row.right}`}>
							<Cell>{row.left}</Cell>
							<Cell>{row.right}</Cell>
						</tr>
					))}
				</tbody>
			</Table>
		</Section>
	)
}
