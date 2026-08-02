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

import { useMediaQuery } from '#/lib/use-media-query'

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

/**
 * The name the router files this scroller's position under. Phones scroll the
 * page itself, which the router already tracks on its own, so only the desktop
 * scroller carries it.
 */
export const SHEET_SCROLL_ID = 'blueprint-sheet'

export function useBlueprintViewportRef(): ViewportRef {
	const ctx = useContext(ViewportRefContext)
	if (!ctx) {
		throw new Error(
			'useBlueprintViewportRef must be used inside <BlueprintSheet>',
		)
	}
	return ctx
}

/**
 * The same viewport, or null when there is no sheet around the caller.
 * Something that merely watches the scrolling — and can fall back to the page
 * itself — can use this and still render outside a sheet, in a test or a
 * standalone screen.
 */
export function useOptionalBlueprintViewportRef(): ViewportRef | null {
	return useContext(ViewportRefContext)
}

export function BlueprintSheet({ children }: { children: React.ReactNode }) {
	const viewportRef = useRef<HTMLDivElement>(null)
	const value = useMemo(() => viewportRef, [])
	// Below 768px the page scrolls as a normal document (the body lock only
	// applies at ≥768px), so the scroll area — which always owns its scroll — is
	// mounted only on the locked-body layout. Phones get plain document scroll.
	const isDesktopScroll = useMediaQuery('(min-width: 768px)', true)
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
					{isDesktopScroll ? (
						<PriScrollArea.Root>
							{/* Naming the scroller lets the router remember how far down it
							    was on the way back, instead of guessing at it by position
							    in the tree — which moves whenever the layout does. */}
							<PriScrollArea.Viewport
								ref={viewportRef}
								data-scroll-restoration-id={SHEET_SCROLL_ID}
							>
								<Content>{children}</Content>
							</PriScrollArea.Viewport>
							<PriScrollArea.Scrollbar orientation='vertical'>
								<PriScrollArea.Thumb />
							</PriScrollArea.Scrollbar>
						</PriScrollArea.Root>
					) : (
						<MobileViewport ref={viewportRef}>
							<Content>{children}</Content>
						</MobileViewport>
					)}
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

	background-color: var(--color-paper-aged);
	background-image:
		radial-gradient(
			ellipse 40px 35px at 15% 30%,
			var(--color-paper-fibre-a) 0%,
			transparent 100%
		),
		radial-gradient(
			ellipse 25px 30px at 78% 55%,
			var(--color-paper-fibre-b) 0%,
			transparent 100%
		),
		radial-gradient(
			ellipse 35px 20px at 45% 80%,
			var(--color-paper-fibre-b) 0%,
			transparent 100%
		),
		repeating-linear-gradient(
			0deg,
			var(--color-blueprint-grid) 0,
			var(--color-blueprint-grid) 0.5px,
			transparent 0.5px,
			transparent 24px
		),
		repeating-linear-gradient(
			90deg,
			var(--color-blueprint-grid) 0,
			var(--color-blueprint-grid) 0.5px,
			transparent 0.5px,
			transparent 24px
		);
	box-shadow:
		0 0 0 1px var(--shadow-color-subtle),
		0 2px 8px var(--shadow-color);

	@media (min-width: 768px) {
		background-image:
			repeating-linear-gradient(
				37deg,
				var(--color-paper-fibre-b) 0,
				var(--color-paper-fibre-b) 2px,
				transparent 2px,
				transparent 7px
			),
			repeating-linear-gradient(
				0deg,
				var(--color-blueprint-grid-strong) 0,
				var(--color-blueprint-grid-strong) 0.5px,
				transparent 0.5px,
				transparent 24px
			),
			repeating-linear-gradient(
				90deg,
				var(--color-blueprint-grid-strong) 0,
				var(--color-blueprint-grid-strong) 0.5px,
				transparent 0.5px,
				transparent 24px
			);
		border: none;
		box-shadow:
			0 1px 2px var(--shadow-color),
			0 4px 12px var(--shadow-color),
			0 8px 24px var(--shadow-color);
		outline: 1px solid var(--color-metal-edge-soft);
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
			var(--color-blueprint-rule-strong) 0,
			var(--color-blueprint-rule-strong) 0.5px,
			transparent 0.5px,
			transparent 24px
		);
		background-repeat: repeat;
		border-bottom: 1px solid var(--color-blueprint-rule);
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
			var(--color-blueprint-rule-strong) 0,
			var(--color-blueprint-rule-strong) 0.5px,
			transparent 0.5px,
			transparent 24px
		);
		background-repeat: repeat;
		border-right: 1px solid var(--color-blueprint-rule);
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
		var(--color-tape) 0%,
		var(--color-tape-light) 30%,
		var(--color-tape) 60%,
		var(--color-tape-light) 100%
	);
	border: 1px solid color-mix(in oklab, var(--color-outline) 40%, transparent);
	box-shadow:
		0 1px 3px var(--shadow-color),
		0 0 0 0.5px var(--shadow-color-subtle);
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
			var(--color-paper-fibre-a) 100%
		);
	}
`

// Phones scroll the document, not an inner viewport. This wrapper holds no
// scroll of its own (so the page scrolls naturally and a touch anywhere works),
// and only exists to keep the ruler-parallax ref pointed at a mounted element.
const MobileViewport = styled.div`
	flex: 1;
	min-width: 0;
	min-height: 0;
`

const Content = styled.div`
	padding: var(--space-lg) var(--space-md);
	padding-bottom: calc(var(--bottom-nav-space) + var(--space-md));
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
