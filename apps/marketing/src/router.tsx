import { createRouter } from '@tanstack/react-router'

import { isLangCode } from '#/i18n'
import { localizeSlug, resolveLocalizedSlug } from '#/i18n/slugs'
import { routeTree } from './routeTree.gen'

/* NotFound renders outside LangProvider (no child route has matched) so
 * translation hooks aren't available — stack all three supported languages
 * statically to keep the page intelligible regardless of the user's locale. */
function NotFound() {
	return <p>Page not found · Pàgina no trobada · Página no encontrada</p>
}

export const getRouter = () => {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		defaultNotFoundComponent: NotFound,
		defaultHashScrollIntoView: { behavior: 'smooth' },
		rewrite: {
			/* Browser URL → router's internal canonical URL.
			 * Only the slug (post-lang) is transformed; the lang prefix is
			 * owned by the $lang param route and never touched by rewrites. */
			input: ({ url }) => {
				const segments = url.pathname.split('/').filter(Boolean)
				if (segments.length >= 2 && isLangCode(segments[0])) {
					const lang = segments[0]
					const localizedSlug = segments.slice(1).join('/')
					const canonical = resolveLocalizedSlug(lang, localizedSlug)
					if (canonical !== null) {
						url.pathname = `/${lang}/${canonical}`
					}
				}
				return url
			},
			/* Router's internal canonical URL → browser URL.
			 * Maps back to each language's canonical localized slug (never an
			 * alias) so both the address bar and `rel=canonical` point at one
			 * canonical form per language. */
			output: ({ url }) => {
				const segments = url.pathname.split('/').filter(Boolean)
				if (segments.length >= 2 && isLangCode(segments[0])) {
					const lang = segments[0]
					const canonicalSlug = segments.slice(1).join('/')
					const localized = localizeSlug(lang, canonicalSlug)
					if (localized !== null) {
						url.pathname =
							localized === '' ? `/${lang}` : `/${lang}/${localized}`
					}
				}
				return url
			},
		},
	})
	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
