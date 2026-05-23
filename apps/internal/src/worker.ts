// Cloudflare Worker entry. Forwards Better Auth and typed-REST traffic to
// the API origin (no nitro routeRules layer on Workers), and hands every
// other request to TanStack Start's SSR runtime. Mirrors the dev-side
// `server.proxy` in vite.config.ts so behaviour is the same across envs.

import ssrHandler from '@tanstack/react-start/server-entry'

const API_ORIGIN = 'https://api.batuda.co'

const isProxied = (pathname: string): boolean =>
	pathname === '/openapi.json' ||
	pathname === '/docs' ||
	pathname.startsWith('/auth/') ||
	pathname.startsWith('/v1/') ||
	pathname.startsWith('/docs/')

// `ssrHandler` is TanStack's pre-built Worker entry; its `Request` type
// expects `IncomingRequestCfProperties`, which only the runtime knows it
// can guarantee. Re-shape the call site as `ExportedHandlerFetchHandler`
// so the wrapped handler matches whatever request the runtime hands us.
const ssrFetch = (
	ssrHandler as unknown as { fetch: ExportedHandlerFetchHandler }
).fetch

export default {
	async fetch(request, env, ctx) {
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
		return ssrFetch(request, env, ctx)
	},
} satisfies ExportedHandler
