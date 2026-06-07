import { useCallback, useSyncExternalStore } from 'react'

/**
 * SSR-safe media query. `useSyncExternalStore` keeps server and first client
 * render in agreement (no hydration mismatch) and updates live as the viewport
 * crosses the breakpoint.
 *
 * `serverDefault` is the value assumed during SSR, where `matchMedia` doesn't
 * exist. Default to the value that renders the safer markup for your case —
 * e.g. the desktop layout for a desktop-first app, so a wide first paint isn't
 * briefly clipped before hydration.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const mql = window.matchMedia(query)
			mql.addEventListener('change', onChange)
			return () => mql.removeEventListener('change', onChange)
		},
		[query],
	)
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(query).matches,
		() => serverDefault,
	)
}
