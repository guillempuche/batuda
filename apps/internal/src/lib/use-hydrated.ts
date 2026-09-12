import { useSyncExternalStore } from 'react'

const subscribeToNothing = () => () => {}

/**
 * `false` while React is still matching the server's HTML, `true` from the
 * first render after that. Read it before showing anything the server could
 * not know — data a browser-side store already holds, the viewport, the clock.
 *
 * React renders the server snapshot during hydration, so the first client
 * render is identical to the server's whatever the browser already knows; the
 * value flips afterwards and the component renders once more with the real
 * thing. Without this, a store that answered before hydration draws a
 * different tree than the server sent, React throws the whole subtree away
 * and rebuilds it, and the page flashes.
 */
export function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribeToNothing,
		() => true,
		() => false,
	)
}
