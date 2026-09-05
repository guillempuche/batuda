import { css, styled } from 'next-yak'

/**
 * Batuda-internal table primitive. Compound export: `PriTable = { Root, Head,
 * Body, Row, ColumnHeader, Cell, Resizer }`. Semantic `<table>` subtree with
 * `display: block`/`flex` overrides so a row can restack as a card on narrow
 * screens and the head can stay pinned. Explicit ARIA roles are set so
 * assistive tech still treats the subtree as a table after CSS display
 * overrides strip the implicit roles.
 *
 * Columns are sized inline by the consumer (TanStack Table's
 * `column.getSize()`). By default a cell keeps that width fixed; pass
 * `$flex="grow"` to fill the free width or `$flex="shrink"` to give way when
 * the row is narrow. A 1024px breakpoint collapses the table into a stacked
 * card for mobile.
 */

// Every part of the table names its own role. A `display: block`/`flex`/`grid`
// override drops the role a browser would otherwise infer from the tag, and the
// chain has to be unbroken — a table owns rowgroups, a rowgroup owns rows, a row
// owns cells — or a screen reader stops treating any of it as a table.
const Root = styled.table.attrs({ role: 'table' })<{ $dense?: boolean }>`
	width: 100%;
	border-collapse: separate;
	border-spacing: 0;
	font-family: var(--font-body);
	color: var(--color-on-surface);
	background: var(--color-surface);
	display: block;
`

const Head = styled.thead.attrs({ role: 'rowgroup' })`
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

const Body = styled.tbody.attrs({ role: 'rowgroup' })`
	display: block;
	position: relative;
`

const Row = styled.tr.attrs({ role: 'row' })`
	display: flex;
	align-items: stretch;
	width: 100%;
	/* Keyboard focus scrolls a row into view against the page, which has the
	   pinned head across its top and, on a phone, the nav bar across its
	   bottom. Hold the row clear of both so focus is never behind them. */
	scroll-margin-block: 3rem calc(var(--bottom-nav-space) + var(--space-sm));
	transition: background 120ms ease;
	border-bottom: 1px solid var(--color-outline-variant);
	cursor: pointer;

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

const flexFor = (intent?: 'fixed' | 'grow' | 'shrink') =>
	intent === 'grow' ? '1 1 0' : intent === 'shrink' ? '0 1 auto' : '0 0 auto'

const ColumnHeader = styled.th.attrs({ role: 'columnheader' })<{
	$align?: 'left' | 'right' | 'center'
	$flex?: 'fixed' | 'grow' | 'shrink'
}>`
	position: relative;
	flex: ${p => flexFor(p.$flex)};
	min-width: ${p => (p.$flex === 'grow' || p.$flex === 'shrink' ? '0' : 'auto')};
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

const Cell = styled.td.attrs({ role: 'cell' })<{
	$align?: 'left' | 'right' | 'center'
	$numeric?: boolean
	$flex?: 'fixed' | 'grow' | 'shrink'
}>`
	flex: ${p => flexFor(p.$flex)};
	min-width: ${p => (p.$flex === 'grow' || p.$flex === 'shrink' ? '0' : 'auto')};
	box-sizing: border-box;
	padding: var(--space-xs) var(--space-sm);
	vertical-align: top;
	overflow: hidden;
	text-overflow: ellipsis;
	text-align: ${p => p.$align ?? 'left'};
	${p => p.$numeric && css`font-variant-numeric: tabular-nums;`}

	@media (max-width: 1024px) {
		display: block;
		/* Row sizing sets an inline pixel width per column; in the stacked
		   card that width would overflow the viewport, so drop it. */
		width: auto !important;
		padding: var(--space-3xs) 0;
	}
`

const Resizer = styled.div<{ $isResizing?: boolean }>`
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
