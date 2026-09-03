import { createRouter, stringifySearchWith } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

function NotFound() {
	return <p>Pàgina no trobada</p>
}

/**
 * A filter holding several values is written into the address as one
 * comma-separated value, not as JSON.
 *
 * The router would otherwise write `?status=["contacted","responded"]`, and the
 * API reads `?status=contacted,responded` — the same list in two spellings, one
 * of which nobody can type. Writing the form the server already reads keeps a
 * link people share, hand-edit and paste into a terminal working everywhere.
 *
 * Only the array case is ours; everything else is handed to the router's own
 * encoder unchanged, and the companies list and its board are the only routes
 * with a list-valued filter today.
 */
const stringifySearch = stringifySearchWith(
	value =>
		Array.isArray(value) && value.every(entry => typeof entry === 'string')
			? (value as ReadonlyArray<string>).join(',')
			: JSON.stringify(value),
	// Without this second half a value that merely looks like JSON is written
	// bare: the text `2024` comes back as the number 2024, and every field typed
	// as text then drops it. Searching for a year, a phone number or the word
	// `true` silently cleared the box — on every screen, not just this one.
	JSON.parse,
)

export const getRouter = () => {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		defaultNotFoundComponent: NotFound,
		defaultHashScrollIntoView: { behavior: 'smooth' },
		stringifySearch,
	})
	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
