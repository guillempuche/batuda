import styled from 'styled-components'

import { FooterStampContent } from './footer-stamp'
import { LanguageSelect } from './language-select'

/* Metal label plate — small plate on the pegboard, phone only.
 * Matches desktop FooterPlate look and feel. */
const Footer = styled.footer.withConfig({ displayName: 'WorkshopFooter' })`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-xs);
	margin: var(--space-xs) auto;
	/* Clear the fixed ToolBelt and any iOS safe-area inset, plus visible
	 * breathing room so the plate doesn't look glued to the toolbelt. The
	 * breathing-room token (--space-lg) is a clamp() so it scales from
	 * ~20px on small phones to ~28px on larger ones. */
	margin-bottom: calc(
		var(--space-lg) + var(--toolbelt-height) +
			env(safe-area-inset-bottom, 0px)
	);
	padding: var(--space-sm) var(--space-md);
	background:
		var(--texture-brushed-metal),
		linear-gradient(
			135deg,
			var(--color-metal-dark) 0%,
			var(--color-metal-light) 50%,
			var(--color-metal-dark) 100%
		);
	border: 1px solid rgba(0, 0, 0, 0.15);
	box-shadow: var(--elevation-workshop-sm);
	position: relative;

	/* Short viewports (phones in landscape, foldables): shrink the gap so
	 * the footer plate still fits above the fold when scrolled to. */
	@media (max-height: 600px) {
		margin-bottom: calc(
			var(--space-sm) + var(--toolbelt-height) +
				env(safe-area-inset-bottom, 0px)
		);
	}

	/* Screw dots */
	&::before,
	&::after {
		content: '';
		position: absolute;
		width: 5px;
		height: 5px;
		border-radius: var(--shape-full);
		background: radial-gradient(
			circle at 35% 35%,
			var(--color-metal),
			var(--color-metal-deep)
		);
		border: 1px solid rgba(0, 0, 0, 0.12);
		flex-shrink: 0;
	}

	&::before {
		top: var(--space-xs);
		left: var(--space-xs);
	}

	&::after {
		top: var(--space-xs);
		right: var(--space-xs);
	}

	@media (min-width: 768px) {
		display: none;
	}
`

const StampRow = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
`

export function WorkshopFooter() {
	return (
		<Footer>
			<StampRow>
				<FooterStampContent />
			</StampRow>
			<LanguageSelect />
		</Footer>
	)
}
