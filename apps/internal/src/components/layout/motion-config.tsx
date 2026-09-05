import { MotionConfig } from 'motion/react'

/**
 * Thin wrapper that sets Batuda's global motion defaults:
 *   - spring physics for every `animate`/`layout`/`variants` transition
 *     unless overridden at the call site;
 *   - `reducedMotion='user'` so the whole app respects the OS preference
 *     without any extra wiring in individual components.
 *
 * Mounted by the `_authed` layout route alongside `<LayoutGroup>`, so both
 * apply to every `motion` component a signed-in page renders. The sign-in
 * pages and the OAuth consent screen sit outside it and animate nothing.
 */
export function BatudaMotionConfig({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<MotionConfig
			reducedMotion='user'
			transition={{ type: 'spring', stiffness: 400, damping: 28 }}
		>
			{children}
		</MotionConfig>
	)
}
