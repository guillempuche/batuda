import { type ReactNode, useEffect } from 'react'

/**
 * Lets a leaf route push a deep page string into `document.title` so
 * the browser tab and bookmarks reflect the current company name,
 * thread subject, page title, or active tab. The TopBar visible
 * heading deliberately stays at the section level (Companies, Emails,
 * …) — that's what the route's `head()` option produces on the server
 * via `<HeadContent />`, and what the user sees inside the app — so
 * the in-page header (e.g. brushed-metal company plate) is the only
 * place that surfaces the deep label visually.
 *
 * Pattern: the route's component calls `useSetDocumentTitle(label)`
 * from a useEffect; the cleanup restores whatever `head()` last wrote
 * so a back navigation doesn't leave the stale string on the next
 * route's tab. `head()` reactively re-runs on route change but does
 * NOT re-run on search-param changes inside the same route, so this
 * hook is what makes tab toggles update the browser tab.
 */

const APP_NAME = 'Batuda'

export function TopBarTitleProvider({ children }: { children: ReactNode }) {
	// Provider remains in the tree so the public API stays stable — but
	// state lives entirely in `document.title` now (one source of truth)
	// because TopBar reads the route-level fallback and never touches
	// the deep override.
	return <>{children}</>
}

export function useSetDocumentTitle(next: string | null): void {
	useEffect(() => {
		if (next === null) return
		const previous = document.title
		document.title = `${next} — ${APP_NAME}`
		return () => {
			// Restore whatever `<HeadContent />` last wrote — typically the
			// new route's static head() value once navigation lands. Avoids
			// leaving a stale "Marisqueria · Conversations" tab title after
			// the user goes back to /companies.
			document.title = previous
		}
	}, [next])
}
