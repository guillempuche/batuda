// `__INTERNAL_DEV_PORT__` is injected by vite.config's `define`: the dev
// server's real port, baked in at config time. The dev SSR runtime (workerd)
// can't read `process.env`, so the dev branch below uses this constant.
declare const __INTERNAL_DEV_PORT__: string

/**
 * Single source of truth for the URL the frontend uses to reach the API.
 *
 * The same module is imported from browser code (`auth-client`,
 * `batuda-api-atom`, `email-attachments`, ...) and SSR code
 * (`session-check`, `batuda-api-server`). It returns:
 *
 *   - **Client in dev** → `window.location.origin` (same-origin
 *     absolute). The browser fetches `/auth/*` and `/v1/*` on the
 *     frontend host; Vite proxies to the API (see `vite.config.ts`).
 *     The session cookie stays host-only on `batuda.localhost`, so
 *     cross-origin calls would not attach it. We return an absolute URL
 *     (not just `''`) because Effect's HttpApiClient builds full
 *     request URLs eagerly and several consumers concat strings rather
 *     than treat empty as "use document base" — passing an explicit
 *     origin keeps every code path identical.
 *   - **Client in prod** → `VITE_SERVER_URL` (absolute API origin). The
 *     browser fetches cross-origin and the parent-domain cookie flows
 *     via `credentials: 'include'`.
 *   - **SSR in dev** → `http://127.0.0.1:${__INTERNAL_DEV_PORT__}` (the
 *     Vite dev server itself — the port is baked in at config time because
 *     the workerd SSR runtime can't read `process.env`). Vite then proxies
 *     `/auth/*` and `/v1/*` to the API with `secure: false`. The SSR
 *     runtime never has to validate portless's self-signed cert chain.
 *     Defense in depth: TLS verification stays on globally; only the
 *     dev-only loopback proxy hop ignores it.
 *   - **SSR in prod** → absolute `VITE_SERVER_URL`. No proxy, real TLS.
 */
export function apiBaseUrl(): string {
	const fromEnv =
		(typeof import.meta !== 'undefined' &&
			import.meta.env?.['VITE_SERVER_URL']) ||
		''
	if (typeof import.meta === 'undefined') return fromEnv
	if (import.meta.env.SSR) {
		if (!import.meta.env.DEV) return fromEnv
		return `http://127.0.0.1:${__INTERNAL_DEV_PORT__}`
	}
	if (import.meta.env.DEV) {
		if (typeof window !== 'undefined') return window.location.origin
		return ''
	}
	return fromEnv
}
