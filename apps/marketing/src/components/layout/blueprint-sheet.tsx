import styled from 'styled-components'

/*
 * The wrapper holds tape strips and the fold overlay outside the paper's
 * overflow context so they are never clipped.
 */
const Wrapper = styled.div.attrs({ 'data-component': 'BlueprintSheet' })`
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	min-height: 0;
	position: relative;
`

const Sheet = styled.div`
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	min-height: 0;
	position: relative;

	@media (min-width: 1024px) {
		/* Aged technical drawing paper */
		background-color: #EDE5D0;
		background-image:
			repeating-linear-gradient(
				37deg,
				rgba(160, 145, 120, 0.03) 0,
				rgba(160, 145, 120, 0.03) 2px,
				transparent 2px,
				transparent 7px
			),
			repeating-linear-gradient(
				0deg,
				rgba(120, 110, 90, 0.15) 0,
				rgba(120, 110, 90, 0.15) 0.5px,
				transparent 0.5px,
				transparent 24px
			),
			repeating-linear-gradient(
				90deg,
				rgba(120, 110, 90, 0.15) 0,
				rgba(120, 110, 90, 0.15) 0.5px,
				transparent 0.5px,
				transparent 24px
			);
		border: none;
		/* Cut the bottom-right corner so pegboard shows through */
		clip-path: polygon(
			0 0,
			100% 0,
			100% calc(100% - 36px),
			calc(100% - 36px) 100%,
			0 100%
		);
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.1),
			0 4px 12px rgba(0, 0, 0, 0.12),
			0 8px 24px rgba(0, 0, 0, 0.1);
		/* Edge lift — paper curls slightly at edges */
		outline: 1px solid rgba(0, 0, 0, 0.04);
	}
`

/* Ruler along top edge */
const TopRuler = styled.div`
	display: none;

	@media (min-width: 1024px) {
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 14px;
		z-index: 1;
		background:
			repeating-linear-gradient(
				90deg,
				rgba(100, 90, 70, 0.35) 0,
				rgba(100, 90, 70, 0.35) 0.5px,
				transparent 0.5px,
				transparent 24px
			);
		border-bottom: 1px solid rgba(100, 90, 70, 0.25);
	}
`

/* Ruler along left edge */
const LeftRuler = styled.div`
	display: none;

	@media (min-width: 1024px) {
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		width: 14px;
		z-index: 1;
		background:
			repeating-linear-gradient(
				0deg,
				rgba(100, 90, 70, 0.35) 0,
				rgba(100, 90, 70, 0.35) 0.5px,
				transparent 0.5px,
				transparent 24px
			);
		border-right: 1px solid rgba(100, 90, 70, 0.25);
	}
`

/* Masking tape — sits on the Wrapper, above the clipped Sheet */
const Tape = styled.span<{ $right?: boolean }>`
	display: none;

	@media (min-width: 1024px) {
		display: block;
		position: absolute;
		top: -4px;
		${p => (p.$right ? 'right: 24px;' : 'left: 24px;')}
		width: 64px;
		height: 24px;
		background:
			linear-gradient(
				${p => (p.$right ? '95deg' : '85deg')},
				#D8D0B8 0%,
				#E2DAC4 30%,
				#D5CDB5 60%,
				#DDD5BD 100%
			);
		border: 1px solid rgba(160, 150, 130, 0.4);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.12),
			0 0 0 0.5px rgba(0, 0, 0, 0.04);
		transform: rotate(${p => (p.$right ? '2deg' : '-2deg')});
		z-index: 5;
	}
`

/*
 * Folded paper underside — triangle overlay at bottom-right.
 * Sits on the Wrapper (outside clip-path) so it covers the cut corner.
 */
const FoldOverlay = styled.div`
	display: none;

	@media (min-width: 1024px) {
		display: block;
		position: absolute;
		bottom: 0;
		right: 0;
		width: 36px;
		height: 36px;
		z-index: 4;
		/* Folded paper underside — slightly darker than front */
		background: linear-gradient(
			225deg,
			#C8C0AC 0%,
			#D8D0BC 60%,
			#CCC4B0 100%
		);
		clip-path: polygon(100% 0, 100% 100%, 0 100%);
		/* Crease shadow */
		box-shadow: -2px -2px 6px rgba(0, 0, 0, 0.15);
		filter: drop-shadow(-1px -1px 3px rgba(0, 0, 0, 0.12));
	}
`

/* Aged paper vignette — darker warm edges */
const Vignette = styled.div`
	display: none;

	@media (min-width: 1024px) {
		display: block;
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
		background: radial-gradient(
			ellipse at center,
			transparent 50%,
			rgba(140, 125, 100, 0.06) 100%
		);
	}
`

const Content = styled.div`
	flex: 1;
	min-height: 0;

	@media (min-width: 1024px) {
		overflow-y: auto;
		padding-left: 12px;
		position: relative;
		z-index: 1;
	}
`

export function BlueprintSheet({ children }: { children: React.ReactNode }) {
	return (
		<Wrapper>
			<Tape />
			<Tape $right />
			<Sheet>
				<TopRuler />
				<LeftRuler />
				<Vignette />
				<Content>{children}</Content>
			</Sheet>
			<FoldOverlay />
		</Wrapper>
	)
}
