import styled from 'styled-components'

// Small shared pieces reused across the instruction-template surfaces (the
// templates list, the stack picker, the default-stack editor) so an owner tag
// and an icon button look and behave identically everywhere.

// "Org" / "Mine" ownership tag. Rendered as text (not colour alone) so the
// distinction survives for screen-reader and colour-blind users.
export const OwnerBadge = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

// Square icon-only button (edit / delete / move / remove). Carries its own
// focus-visible ring so keyboard focus stays legible on every surface,
// including the dark brushed-metal rows where the browser default is faint.
// Boundary buttons use aria-disabled (not the disabled attribute) so they stay
// in the tab order and the boundary is perceivable.
export const InstructionIconButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.6rem;
	height: 1.6rem;
	padding: 0;
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 14%, transparent);
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover:not(:disabled):not([aria-disabled='true']) {
		color: var(--color-on-surface);
		border-color: color-mix(in oklab, var(--color-primary) 60%, transparent);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	&:disabled,
	&[aria-disabled='true'] {
		opacity: 0.4;
		cursor: default;
	}
`
