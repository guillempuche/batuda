import { createFileRoute, notFound } from '@tanstack/react-router'

/**
 * Catches every address no signed-in page claims, so a mistyped or stale link
 * still lands inside the app: someone signed out is sent to the sign-in page
 * by the layout's gate, and someone signed in sees "page not found" with the
 * sidebar and top bar around it rather than a bare paragraph.
 *
 * Without this, an unknown address falls through to the root route, which
 * knows nothing about sessions — so the whole app would be reachable by
 * default for any address that happens not to match a page.
 */
export const Route = createFileRoute('/_authed/$')({
	loader: () => {
		throw notFound()
	},
})
