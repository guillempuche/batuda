import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lingui } from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react-swc'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))

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

// Same-origin proxy so Better Auth's `Set-Cookie ... Domain=batuda.localhost`
// is a domain-match for the request host: the cookie applies to both
// `batuda.localhost` (SSR `getRequestHeader('cookie')` on hard reload) AND
// every subdomain (cross-origin `/v1/*` fetches that bypass the proxy still
// attach it). No `cookieDomainRewrite` on purpose.
//
// Rules live on `nitro({ routeRules })`, NOT Vite's `server.proxy`: Nitro's
// plugin registers a `vary: sec-fetch-dest` pre-middleware in `configureServer`
// (nitro/dist/vite.mjs:288) that runs ahead of Vite's internal proxy and
// short-circuits every document-like request into SSR. `routeRules.proxy`
// instead runs inside Nitro's H3 router before its catch-all SSR handler.
//
// Closed list: Better Auth (`/auth/*`), typed REST (`/v1/*`), public docs
// (`/openapi.json`, `/docs`). Everything else stays inside Nitro.
const proxyTo = (suffix: string) => ({
	to: `${apiTarget}${suffix}`,
	secure: false,
})
const nitroRouteRules = {
	'/auth/**': { proxy: proxyTo('/auth/**') },
	'/v1/**': { proxy: proxyTo('/v1/**') },
	'/openapi.json': { proxy: proxyTo('/openapi.json') },
	'/docs': { proxy: proxyTo('/docs') },
	'/docs/**': { proxy: proxyTo('/docs/**') },
} as const

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		// The CJS shim does `require("react")` and creates a duplicate
		// React via Node's CJS cache; SSR's hooks dispatcher lives on
		// the ESM React, so any external-store hook call throws
		// "Invalid hook call". React 19 has `useSyncExternalStore`
		// natively, but aliasing straight to bare `'react'` breaks
		// dev SSR because the alias keeps React in-graph (bypassing
		// externalization) and `react/index.js` is CJS, which Vite's
		// dev module-runner can't execute. The local ESM shims
		// re-export from `react` so both dev and build land on a
		// single instance.
		alias: [
			{
				find: /^use-sync-external-store\/shim\/with-selector$/,
				replacement: resolve(
					here,
					'src/lib/use-sync-external-store-shim-with-selector.ts',
				),
			},
			{
				find: /^use-sync-external-store\/shim$/,
				replacement: resolve(here, 'src/lib/use-sync-external-store-shim.ts'),
			},
			{
				find: /^use-sync-external-store\/shim\/index$/,
				replacement: resolve(here, 'src/lib/use-sync-external-store-shim.ts'),
			},
			{
				find: /^use-sync-external-store\/shim\/index\.js$/,
				replacement: resolve(here, 'src/lib/use-sync-external-store-shim.ts'),
			},
		],
		dedupe: ['react', 'react-dom', '@base-ui/react', '@base-ui/utils'],
		// Drop the default 'node' condition so tslib (and any other
		// dual-pkg dep that styled-components pulls in) resolves to its
		// ESM build. With 'node' first, Vite/Nitro picks the CJS entry
		// and the interop wrapper exposes `__extends` only via a
		// `.default` property — Nitro's prebuild then emits
		// `const { __extends } = tslib.default` which throws at SSR
		// time because tslib's ESM has named exports, not a default.
		//
		// `development` is first so workspace packages with a
		// `"development"` export key (e.g. `@batuda/ui`) resolve to
		// their TS source in dev, not the pre-built `dist/`. Without
		// it Vite picks `import` → `dist/index.mjs`, which tsdown ships
		// without `@swc/plugin-styled-components` componentIds; the SSR
		// pipeline's `noExternal` still re-runs the SWC plugin and adds
		// IDs, while the client loads dist as-is. The classnames then
		// diverge (`pri-input__PriInput-sc-{hash}-0` vs `PriInput-{hash}`)
		// and React 19 bails hydration on every affected subtree —
		// magic-link button onClick stops attaching, sign-in form
		// submits get dropped, etc. Symmetric source load + symmetric
		// transform fixes the mismatch at the root.
		conditions: ['development', 'module', 'import', 'default'],
	},
	ssr: {
		// Bundle through Vite for SSR so the React-using deps go through
		// the same dedupe + conditions as the rest of the SSR graph;
		// otherwise Vite externalizes them and Node's resolver picks a
		// different React/tslib instance and SSR throws on hook calls
		// or `__extends` is undefined.
		noExternal: [
			'styled-components',
			'@batuda/ui',
			'@base-ui/react',
			'@base-ui/utils',
		],
		resolve: { conditions: ['development', 'module', 'import', 'default'] },
	},
	plugins: [
		tanstackStart(),
		nitro({ routeRules: nitroRouteRules }),
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
