import { css } from 'styled-components'

/**
 * Reusable CSS fragments for the Batuda workshop visual language.
 *
 * Each helper is a `styled-components` `css` template so callers can
 * interpolate it inside their own styled-component bodies without
 * pulling the entire chrome into a shared component. The goal is to
 * keep the theatrical workshop look consistent across routes, cards,
 * and dialogs while editing one source of truth when a gradient or
 * rule line needs to move.
 */

/** Aged cream paper with two warm fibre radial-gradients + thin border. */
export const agedPaperSurface = css`
	background-color: var(--color-paper-aged);
	background-image:
		radial-gradient(
			ellipse 40px 30px at 18% 30%,
			var(--color-paper-fibre-a) 0%,
			transparent 100%
		),
		radial-gradient(
			ellipse 50px 30px at 82% 72%,
			var(--color-paper-fibre-b) 0%,
			transparent 100%
		);
	border: 1px solid var(--color-ledger-line);
	box-shadow:
		var(--shadow-paper-inset),
		var(--shadow-paper-card);
`

/**
 * Lighter variant for inline list rows (task rows, timeline rows).
 * Single fibre accent, no outer shadow — the bottom rule does the work.
 */
export const agedPaperRow = css`
	background-color: var(--color-paper-aged);
	background-image: radial-gradient(
		ellipse 60px 40px at 80% 30%,
		var(--color-paper-fibre-b) 0%,
		transparent 100%
	);
`

/** Brushed-metal plate: 145deg metal gradient + noise overlay via ::before. */
export const brushedMetalPlate = css`
	position: relative;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.35);
	box-shadow: var(--elevation-workshop-sm);
	overflow: hidden;
	isolation: isolate;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--texture-brushed-metal);
		pointer-events: none;
		z-index: 0;
	}

	& > * {
		position: relative;
		z-index: 1;
	}
`

/** Rounded brushed-metal button/bezel — for bezels that wrap an icon. */
export const brushedMetalBezel = css`
	position: relative;
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.4);
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.5),
		0 2px 4px rgba(0, 0, 0, 0.25);
	overflow: hidden;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--texture-brushed-metal);
		pointer-events: none;
	}

	& > svg {
		position: relative;
	}
`

/** Ruled ledger row: thin bottom rule + 5n emphasis — for list rows. */
export const ruledLedgerRow = css`
	border-bottom: 1px solid var(--color-ledger-line);

	&:nth-child(5n) {
		border-bottom-width: 2px;
		border-bottom-color: var(--color-ledger-line-strong);
	}
`

/** Dashed ruler under-rule — for page intro headers (Intros under titles). */
export const rulerUnderRule = css`
	background-image: repeating-linear-gradient(
		90deg,
		var(--color-ledger-line-strong) 0 4px,
		transparent 4px 10px
	);
	background-repeat: no-repeat;
	background-position: left bottom;
	background-size: 100% 1px;
`

/** Masking-tape corner strip — absolute, rotated, warm beige linear-gradient. */
export const maskingTapeCorner = css`
	position: absolute;
	top: -12px;
	left: 32px;
	width: 80px;
	height: 22px;
	background: linear-gradient(
		180deg,
		rgba(230, 210, 165, 0.82) 0%,
		rgba(210, 185, 130, 0.9) 100%
	);
	border: 1px solid rgba(160, 130, 70, 0.3);
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
	transform: rotate(-3deg);
	pointer-events: none;
`

/** Stenciled display-font title: uppercase + emboss + display tracking. */
export const stenciledTitle = css`
	font-family: var(--font-display);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`
