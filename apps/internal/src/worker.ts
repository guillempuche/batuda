// Cloudflare Worker entry. Forwards Better Auth and typed-REST traffic to
// the API origin (no nitro routeRules layer on Workers), and hands every
// other request to TanStack Start's SSR runtime. Mirrors the dev-side
// `server.proxy` in vite.config.ts so behaviour is the same across envs.

import {
	createStartHandler,
	defaultStreamHandler,
} from '@tanstack/react-start/server'

const API_ORIGIN = 'https://api.batuda.co'

const isProxied = (pathname: string): boolean =>
	pathname === '/openapi.json' ||
	pathname === '/docs' ||
	pathname.startsWith('/auth/') ||
	pathname.startsWith('/v1/') ||
	pathname.startsWith('/docs/')

// The same handler TanStack's stock Worker entry wraps, called directly so
// the request options below can be passed.
const ssrFetch = createStartHandler(defaultStreamHandler)

export default {
	async fetch(request) {
		const url = new URL(request.url)
		if (isProxied(url.pathname)) {
			// `new Request(target, request)` carries method, headers, and the
			// streamed body to the API origin; the upstream `Set-Cookie`
			// flows back unmodified so Better Auth's `Domain=batuda.co`
			// cookie reaches the browser. A thrown fetch (API down, DNS) is
			// contained as a 502 so it never takes down the SSR Worker.
			const target = `${API_ORIGIN}${url.pathname}${url.search}`
			try {
				return await fetch(new Request(target, request))
			} catch {
				return new Response('Upstream API unreachable', { status: 502 })
			}
		}
		// Names the stylesheet and the fonts in the response's `Link` header, so
		// the browser can start fetching them the moment the headers arrive,
		// before it has parsed the page. Cloudflare turns that header into an
		// Early Hints response on later visits, which reaches the browser while
		// the Worker is still rendering. Scripts are left out: Early Hints do not
		// carry modulepreload, and the header would otherwise run to dozens of
		// entries. Written inline so `hint` keeps the framework's own type.
		return ssrFetch(request, {
			responseLinkHeader: {
				filter: ({ hint }) =>
					hint.rel === 'preconnect' ||
					(hint.rel === 'preload' &&
						(hint.as === 'style' || hint.as === 'font')),
			},
		})
	},
} satisfies ExportedHandler
