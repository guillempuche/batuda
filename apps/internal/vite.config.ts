import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import { lingui } from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react-swc'
import { viteYak } from 'next-yak/vite'
import { defineConfig, type Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Puts every generated stylesheet into a named cascade layer: `lib` for the
 * shared components in `packages/ui`, `app` for this app's own.
 *
 * When the styling was assembled in the browser it was added in the order the
 * components first rendered, and the app's own rules always landed after the
 * shared ones — so when both set the same property with equal weight, the app
 * won. Preparing the styles ahead of time replaces that with the order the
 * bundler happens to write the files in, which is not a rule anyone chose.
 * Naming the layers puts the same answer back and writes it down, so an
 * override keeps working without anyone reaching for `!important`.
 *
 * The order itself is declared once, at the top of `src/styles.css`.
 */
function yakLayers(): Plugin {
	return {
		name: 'yak-cascade-layers',
		enforce: 'pre',
		transform: {
			filter: { id: /^\0virtual:yak-css:/ },
			handler(code, id) {
				const layer = /node_modules|packages\/ui/.test(id) ? 'lib' : 'app'
				return { code: `@layer ${layer} {\n${code}\n}\n`, map: null }
			},
		},
	}
}

/* `@lingui/swc-plugin` turns `<Trans>…</Trans>` (from `@lingui/react/macro`)
 * into the runtime form with auto-generated message IDs. */

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
//      a worktree at `feature-x.batuda.localhost:<port>` proxy to its
//      matching API at `feature-x.api.batuda.localhost:<port>` — the
//      same port portless bound (it falls back to a non-privileged port
//      like :1355 when it can't bind 443) — with no per-worktree env file.
//   3. Default `https://api.batuda.localhost` for the main checkout.
const portlessUrl = process.env['PORTLESS_URL']
const derivedApiTarget = (() => {
	if (!portlessUrl) return null
	const marker = 'batuda.localhost'
	try {
		const url = new URL(portlessUrl)
		if (!url.hostname.endsWith(marker)) return null
		const apiHost = url.hostname.replace(marker, `api.${marker}`)
		// Keep portless's bound port (e.g. :1355) so the proxy reaches the API
		// portless actually serves, and pin https since portless fronts these
		// hosts with TLS. The default :443 is left off the host.
		const portSuffix = url.port && url.port !== '443' ? `:${url.port}` : ''
		return `https://${apiHost}${portSuffix}`
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
// Closed list: Better Auth (`/auth/*`), typed REST (`/v1/*`), public docs
// (`/openapi.json`, `/docs`). Everything else stays inside the SSR app.
//
// Production (Cloudflare Workers): the same forwarding runs inside the
// Worker entry (see `src/worker.ts`) because there is no nitro layer; CF
// has no equivalent of nitro's `routeRules` proxy. The dev `server.proxy`
// below mirrors the Worker's prod behavior so dev parity holds.
const apiProxy = {
	target: apiTarget,
	changeOrigin: true,
	secure: false,
}
const devProxy = {
	'/auth': apiProxy,
	'/v1': apiProxy,
	'/openapi.json': apiProxy,
	'/docs': apiProxy,
}

const config = defineConfig(({ command }) => {
	// The dev SSR runtime is workerd (the Cloudflare plugin below), which
	// can't read this Node process's env — so the SSR session check has no
	// way to learn the dev server's port to call back through. portless
	// launches us as `PORT=<n> vite dev --port <n> --strictPort`, so the real
	// port is known here at config time; bake it into the bundle. Require it
	// rather than guessing a default: a wrong port surfaces as a silent
	// /login bounce on every authed hard-load, not a clear error.
	if (command === 'serve' && !process.env['PORT']) {
		throw new Error(
			'PORT is not set. Start the dev server with `pnpm dev` (portless ' +
				'assigns and exports PORT). Without it the SSR session check ' +
				"can't reach the dev server, so every authed page hard-load " +
				'bounces to /login.',
		)
	}
	return {
		define: {
			// Read only in the dev-SSR branch of api-base; the consuming branch
			// is dead-code-eliminated in prod builds, so the value is unused there.
			__INTERNAL_DEV_PORT__: JSON.stringify(process.env['PORT'] ?? '0'),
		},
		server: {
			proxy: devProxy,
		},
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
			// dual-package dependency pulled in here) resolves to its
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
			// unbuilt. Class names are worked out from each file's path, so
			// SSR reading the source while the browser reads `dist/` gives
			// two different names for the same component, and React 19 bails
			// hydration on every affected subtree —
			// magic-link button onClick stops attaching, sign-in form
			// submits get dropped, etc. Symmetric source load + symmetric
			// transform fixes the mismatch at the root.
			//
			// `browser` is listed because naming any condition here replaces
			// Vite's own client-side list rather than adding to it, and that
			// list normally carries `browser`. A package that ships separate
			// browser and Node builds — `@react-email/render` does — would
			// otherwise hand the browser its Node build, which reaches for
			// Node-only globals and throws as soon as it runs.
			conditions: ['development', 'module', 'browser', 'import', 'default'],
		},
		ssr: {
			// Bundle through Vite for SSR so the React-using deps go through
			// the same dedupe + conditions as the rest of the SSR graph;
			// otherwise Vite externalizes them and Node's resolver picks a
			// different React/tslib instance and SSR throws on hook calls
			// or `__extends` is undefined.
			noExternal: [
				'next-yak',
				'@batuda/ui',
				'@base-ui/react',
				'@base-ui/utils',
			],
			resolve: { conditions: ['development', 'module', 'import', 'default'] },
		},
		plugins: [
			tailwindcss(),
			cloudflare({ viteEnvironment: { name: 'ssr' } }),
			tanstackStart(),
			/* Turns `styled`/`css` templates into real CSS files at build time.
			 * It has to see the original source, so it runs before the React
			 * plugin — both ask to run early, and when two plugins both do,
			 * the order in this array is what settles it.
			 *
			 * `basePath` is the repo root because `packages/ui` sits outside
			 * this app's folder. The names of the generated CSS files are
			 * worked out relative to this path, so pointing it at the app
			 * instead would put the shared components' styles out of reach. */
			/* Turns `styled`/`css` templates into real CSS files at build time.
			 * It has to see the original source, so it runs before the React
			 * plugin — both ask to run early, and when two plugins both do,
			 * the order in this array is what settles it.
			 *
			 * `basePath` is the repo root because `packages/ui` sits outside
			 * this app's folder. The names of the generated CSS files are
			 * worked out relative to this path, so pointing it at the app
			 * instead would put the shared components' styles out of reach.
			 *
			 * `minify` is on in development too, which is not the default.
			 * Left off, the generated names are built from the file's name —
			 * and a route file for a changing part of the address is called
			 * `$slug.tsx`, so they come out as `--$slug_Badge__color_xxx`. A
			 * `$` cannot appear in a CSS name, so the browser throws those
			 * declarations away and the page quietly loses styling that is
			 * perfectly fine once built for real. Shortening the names in
			 * both places also means what you see while developing is what
			 * ships. The cost is that class names in devtools read as
			 * `.yuiqpR8d` rather than the component's name. */
			viteYak({ basePath: resolve(here, '../..'), minify: true }),
			yakLayers(),
			viteReact({
				plugins: [['@lingui/swc-plugin', {}]],
			}),
			lingui(),
		],
	}
})

export default config
