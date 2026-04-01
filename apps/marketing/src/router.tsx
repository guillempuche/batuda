import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

function NotFound() {
	return <p>Pàgina no trobada</p>
}

export const getRouter = () => {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		defaultNotFoundComponent: NotFound,
	})
	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
