import { css } from 'styled-components'

/* Single source of truth for the orange forged-steel CTA button.
 *
 * Used by both `HeroCta` (a TanStack Link) and `ControlPanel`'s primary
 * button (a plain anchor). Exported as a CSS mixin instead of a component so
 * each call site can keep its own underlying element type without losing
 * router-aware behaviors. */
export const workshopButtonStyles = css`
	display: inline-flex;
	align-items: center;
	padding: var(--space-sm) var(--space-2xl);
	background: linear-gradient(135deg, #b85a28 0%, #c46a38 50%, #a04a18 100%);
	border: 1px solid rgba(0, 0, 0, 0.2);
	box-shadow: var(--elevation-workshop-md);
	color: var(--color-on-primary);
	border-radius: 2px;
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-engrave);
	text-decoration: none;
	transition:
		box-shadow 0.15s,
		transform 0.1s;
	cursor: pointer;

	&:hover {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.25),
			0 3px 6px rgba(0, 0, 0, 0.2);
	}

	&:focus-visible {
		outline: 2px solid #ffd9a8;
		outline-offset: 3px;
	}
`
