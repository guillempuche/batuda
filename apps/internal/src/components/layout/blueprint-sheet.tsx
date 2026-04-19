import { motion, useScroll, useTransform } from 'motion/react'
import {
	createContext,
	type RefObject,
	useContext,
	useMemo,
	useRef,
} from 'react'
import styled from 'styled-components'

import { PriScrollArea } from '@batuda/ui/pri'

/**
 * Batuda blueprint sheet — aged technical-drawing paper with cross-hatch +
 * grid, tape strips at the top corners, and sticky rulers along the top
 * and left edges. The inner PriScrollArea viewport is the scroll owner
 * (body is locked at ≥768px) so sticky rulers + the metal rail scrollbar
 * stay visible while content scrolls underneath.
 *
 * Unlike marketing's sheet, Batuda drops the folded-corner effect — tape +
 * rulers + cross-hatch + vignette are enough to carry the metaphor and
 * stay readable across long CRM content.
 *
 * A React context exposes the viewport ref so motion-powered features
 * (parallax rulers, scroll-spy) can hook `useScroll({ container })`
 * without a prop-drilling dance.
 */

type ViewportRef = RefObject<HTMLDivElement | null>

const ViewportRefContext = createContext<ViewportRef | null>(null)

export function useBlueprintViewportRef(): ViewportRef {
	const ctx = useContext(ViewportRefContext)
	if (!ctx) {
		throw new Error(
			'useBlueprintViewportRef must be used inside <BlueprintSheet>',
		)
	}
	return ctx
}

export function BlueprintSheet({ children }: { children: React.ReactNode }) {
	const viewportRef = useRef<HTMLDivElement>(null)
	const value = useMemo(() => viewportRef, [])
	const { scrollYProgress } = useScroll({ container: viewportRef })
	// Parallel-rule effect: top ruler ticks drift horizontally as the user
	// scrolls the sheet, so the drafting-table metaphor stays alive.
	const rulerShiftX = useTransform(scrollYProgress, [0, 1], ['0px', '-120px'])
	const rulerShiftY = useTransform(scrollYProgress, [0, 1], ['0px', '-120px'])

	return (
		<ViewportRefContext.Provider value={value}>
			<Wrapper>
				<Tape />
				<Tape $right />
				<Sheet>
					<TopRuler style={{ backgroundPositionX: rulerShiftX }} />
					<LeftRuler style={{ backgroundPositionY: rulerShiftY }} />
					<Vignette />
					<PriScrollArea.Root>
						<PriScrollArea.Viewport ref={viewportRef}>
							<Content>{children}</Content>
						</PriScrollArea.Viewport>
						<PriScrollArea.Scrollbar orientation='vertical'>
							<PriScrollArea.Thumb />
						</PriScrollArea.Scrollbar>
					</PriScrollArea.Root>
				</Sheet>
			</Wrapper>
		</ViewportRefContext.Provider>
	)
}

const Wrapper = styled.div.withConfig({ displayName: 'BlueprintSheet' })`
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	min-height: 0;
	position: relative;

	@media (max-width: 767px) {
		margin: var(--space-sm);
	}
`

const Sheet = styled.div`
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	min-height: 0;
	position: relative;

	background-color: #ede5d0;
	background-image:
		radial-gradient(
			ellipse 40px 35px at 15% 30%,
			rgba(180, 155, 120, 0.06) 0%,
			transparent 100%
		),
		radial-gradient(
			ellipse 25px 30px at 78% 55%,
			rgba(170, 145, 110, 0.05) 0%,
			transparent 100%
		),
		radial-gradient(
			ellipse 35px 20px at 45% 80%,
			rgba(175, 150, 115, 0.04) 0%,
			transparent 100%
		),
		repeating-linear-gradient(
			0deg,
			rgba(120, 110, 90, 0.08) 0,
			rgba(120, 110, 90, 0.08) 0.5px,
			transparent 0.5px,
			transparent 24px
		),
		repeating-linear-gradient(
			90deg,
			rgba(120, 110, 90, 0.08) 0,
			rgba(120, 110, 90, 0.08) 0.5px,
			transparent 0.5px,
			transparent 24px
		);
	box-shadow:
		0 0 0 1px rgba(0, 0, 0, 0.04),
		0 2px 8px rgba(0, 0, 0, 0.1);

	@media (min-width: 768px) {
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
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.1),
			0 4px 12px rgba(0, 0, 0, 0.12),
			0 8px 24px rgba(0, 0, 0, 0.1);
		outline: 1px solid rgba(0, 0, 0, 0.04);
	}
`

const TopRuler = styled(motion.div)`
	display: none;

	@media (min-width: 768px) {
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 14px;
		z-index: 1;
		background: repeating-linear-gradient(
			90deg,
			rgba(100, 90, 70, 0.35) 0,
			rgba(100, 90, 70, 0.35) 0.5px,
			transparent 0.5px,
			transparent 24px
		);
		background-repeat: repeat;
		border-bottom: 1px solid rgba(100, 90, 70, 0.25);
		will-change: background-position;
	}
`

const LeftRuler = styled(motion.div)`
	display: none;

	@media (min-width: 768px) {
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		width: 14px;
		z-index: 1;
		background: repeating-linear-gradient(
			0deg,
			rgba(100, 90, 70, 0.35) 0,
			rgba(100, 90, 70, 0.35) 0.5px,
			transparent 0.5px,
			transparent 24px
		);
		background-repeat: repeat;
		border-right: 1px solid rgba(100, 90, 70, 0.25);
		will-change: background-position;
	}
`

const Tape = styled.span<{ $right?: boolean }>`
	display: block;
	position: absolute;
	top: ${p => (p.$right ? '-5px' : '-4px')};
	${p => (p.$right ? 'right: 20px;' : 'left: 16px;')}
	width: ${p => (p.$right ? '54px' : '48px')};
	height: ${p => (p.$right ? '17px' : '18px')};
	background: linear-gradient(
		${p => (p.$right ? '97deg' : '84deg')},
		#d8d0b8 0%,
		#e2dac4 30%,
		#d5cdb5 60%,
		#ddd5bd 100%
	);
	border: 1px solid rgba(160, 150, 130, 0.4);
	box-shadow:
		0 1px 3px rgba(0, 0, 0, 0.12),
		0 0 0 0.5px rgba(0, 0, 0, 0.04);
	transform: rotate(${p => (p.$right ? '1.6deg' : '-2.3deg')});
	z-index: 5;

	@media (min-width: 768px) {
		${p => (p.$right ? 'right: 24px;' : 'left: 24px;')}
		width: 64px;
		height: 24px;
	}
`

const Vignette = styled.div`
	display: none;

	@media (min-width: 768px) {
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
	padding: var(--space-lg) var(--space-md);
	padding-bottom: calc(
		var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px) +
			var(--space-md)
	);
	position: relative;
	z-index: 2;

	@media (min-width: 768px) {
		padding-top: var(--space-xl);
		padding-right: var(--space-xl);
		padding-left: calc(var(--space-xl) + 14px);
	}

	@media (min-width: 1024px) {
		padding-bottom: var(--space-xl);
	}
`
