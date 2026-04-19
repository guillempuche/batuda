import styled from 'styled-components'

/**
 * Batuda-internal table primitive. Compound export: `PriTable = { Root, Head,
 * Body, Row, ColumnHeader, Cell, Resizer }`. Semantic `<table>` subtree with
 * `display: block`/`flex` overrides so TanStack Virtual rows can live inside
 * `<tbody>` as absolutely-positioned `<tr>`s. Explicit ARIA roles are set so
 * assistive tech still treats the subtree as a table after CSS display
 * overrides strip the implicit roles.
 *
 * Columns are sized inline by the consumer (TanStack Table's
 * `column.getSize()`); cells use `flex: 0 0 <size>px`. A 1024px breakpoint
 * collapses the table into a stacked card for mobile.
 */

const Root = styled.table.withConfig({
	displayName: 'PriTable.Root',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{ $dense?: boolean }>`
	width: 100%;
	border-collapse: separate;
	border-spacing: 0;
	font-family: var(--font-body);
	color: var(--color-on-surface);
	background: var(--color-surface);
	display: block;
`

const Head = styled.thead.withConfig({
	displayName: 'PriTable.Head',
})`
	display: block;
	position: sticky;
	top: 0;
	z-index: 1;
	background-color: var(--color-surface-container-low);
	background-image: repeating-linear-gradient(
		90deg,
		var(--color-outline) 0 4px,
		transparent 4px 10px
	);
	background-repeat: no-repeat;
	background-position: left bottom;
	background-size: 100% 1px;

	@media (max-width: 1024px) {
		display: none;
	}
`

const Body = styled.tbody.withConfig({
	displayName: 'PriTable.Body',
})`
	display: block;
	position: relative;
`

const Row = styled.tr.withConfig({
	displayName: 'PriTable.Row',
})`
	display: flex;
	align-items: stretch;
	width: 100%;
	transition: background 120ms ease;
	border-bottom: 1px solid var(--color-outline-variant);
	cursor: pointer;

	&:nth-child(even) {
		background-color: var(--color-surface-container-low);
	}

	&:hover {
		background-color: var(--color-surface-container-high);
	}

	&[data-selected='true'] {
		background-color: color-mix(
			in oklab,
			var(--color-primary) 14%,
			var(--color-surface)
		);
	}

	&[data-unread='true'] td {
		font-weight: var(--font-weight-medium);
	}

	&[data-draft='true'] {
		box-shadow: inset 3px 0 0 0 var(--color-primary);
	}

	@media (max-width: 1024px) {
		display: grid;
		grid-template-columns: 1fr auto;
		padding: var(--space-sm);
		gap: var(--space-2xs);
	}
`

const ColumnHeader = styled.th.withConfig({
	displayName: 'PriTable.ColumnHeader',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{ $align?: 'left' | 'right' | 'center' }>`
	position: relative;
	flex: 0 0 auto;
	box-sizing: border-box;
	font-family: var(--font-display);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface-variant);
	padding: var(--space-2xs) var(--space-sm);
	text-align: ${p => p.$align ?? 'left'};
	white-space: nowrap;
	user-select: none;
`

const Cell = styled.td.withConfig({
	displayName: 'PriTable.Cell',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{
	$align?: 'left' | 'right' | 'center'
	$numeric?: boolean
}>`
	flex: 0 0 auto;
	box-sizing: border-box;
	padding: var(--space-xs) var(--space-sm);
	vertical-align: top;
	overflow: hidden;
	text-overflow: ellipsis;
	text-align: ${p => p.$align ?? 'left'};
	${p => (p.$numeric ? 'font-variant-numeric: tabular-nums;' : '')}

	@media (max-width: 1024px) {
		display: block;
		padding: var(--space-3xs) 0;
	}
`

const Resizer = styled.div.withConfig({
	displayName: 'PriTable.Resizer',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{ $isResizing?: boolean }>`
	position: absolute;
	right: 0;
	top: 25%;
	bottom: 25%;
	width: 4px;
	cursor: col-resize;
	user-select: none;
	touch-action: none;
	background: ${p => (p.$isResizing ? 'var(--color-primary)' : 'transparent')};
	transition: background 120ms ease;

	&:hover {
		background: var(--color-outline-variant);
	}

	@media (max-width: 1024px) {
		display: none;
	}
`

export const PriTable = {
	Root,
	Head,
	Body,
	Row,
	ColumnHeader,
	Cell,
	Resizer,
}
