import { lingui } from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

/* Batuda uses `@vitejs/plugin-react-swc` so two SWC transforms can run at
 * compile time:
 * - `@lingui/swc-plugin` turns `<Trans>…</Trans>` (from `@lingui/react/macro`)
 *   into the runtime form with auto-generated message IDs.
 * - `@swc/plugin-styled-components` gives every `styled.*` call a stable
 *   `componentId` + `displayName`, so SSR class names match the emitted
 *   `<style data-styled>` rules (otherwise hashes drift and elements fall
 *   back to unstyled defaults). */

// Browser-side API requests are issued against the same origin as the
// frontend so Better Auth's `Set-Cookie` lands on `batuda.localhost` (the
// dev origin) instead of `api.batuda.localhost`. The cross-subdomain
// alternative depends on the browser accepting `Domain=batuda.localhost`
// on a `localhost`-suffixed host, which RFC 6761-aware browsers refuse —
// the SSR-on-reload path then sees no cookie and bounces to /login.
// Production keeps the cross-origin setup (real TLD, browsers always
// accept the parent domain).
//
// Resolution order:
//   1. `INTERNAL_API_URL` — explicit override.
//   2. Derived from `PORTLESS_URL` (set by `portless run`) when the
//      Vite dev server is itself on `*.batuda.localhost`. This makes
//      a worktree at `feature-x.batuda.localhost` proxy to its
//      matching API at `feature-x.api.batuda.localhost` with no per-
//      worktree env file.
//   3. Default `https://api.batuda.localhost` for the main checkout.
const portlessUrl = process.env['PORTLESS_URL']
const derivedApiTarget = (() => {
	if (!portlessUrl) return null
	const marker = 'batuda.localhost'
	try {
		const url = new URL(portlessUrl)
		if (!url.host.endsWith(marker)) return null
		const apiHost = url.host.replace(marker, `api.${marker}`)
		return `${url.protocol}//${apiHost}`
	} catch {
		return null
	}
})()
const apiTarget =
	process.env['INTERNAL_API_URL'] ??
	derivedApiTarget ??
	'https://api.batuda.localhost'

// Proxy scope is the closed enumeration of API paths the frontend talks
// to: Better Auth (`/auth/*`), the typed REST API (`/v1/*`), and the
// public docs surfaces (`/openapi.json`, `/docs`). Anything not in this
// list stays inside the Vite dev server. `secure: false` skips TLS
// validation for the upstream hop because portless ships self-signed
// certs locally — it must never run in prod where Vite isn't in the
// request path. The proxy origin (`batuda.localhost`) is the parent of
// the API origin (`api.batuda.localhost`), so when Better Auth emits
// `Set-Cookie ... Domain=batuda.localhost` the browser accepts it (the
// `Domain` attribute is a domain-match for the request host). The
// resulting cookie applies to BOTH `batuda.localhost` (so SSR
// `getRequestHeader('cookie')` sees it on hard reload) AND every
// subdomain (so cross-origin `/v1/*` fetches that bypass the proxy
// still attach it). We deliberately do NOT set `cookieDomainRewrite`.
const proxyOpts = {
	target: apiTarget,
	changeOrigin: true,
	secure: false,
} as const

const devProxy = {
	'/auth': proxyOpts,
	'/v1': proxyOpts,
	'/openapi.json': proxyOpts,
	'/docs': proxyOpts,
} as const

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	server: {
		proxy: devProxy,
	},
	preview: {
		proxy: devProxy,
	},
	ssr: {
		noExternal: ['styled-components'],
	},
	plugins: [
		tanstackStart(),
		viteReact({
			plugins: [
				['@lingui/swc-plugin', {}],
				[
					'@swc/plugin-styled-components',
					{
						displayName: true,
						ssr: true,
						fileName: true,
						pure: false,
						transpileTemplateLiterals: true,
					},
				],
			],
		}),
		lingui(),
		tailwindcss(),
	],
})

export default config
