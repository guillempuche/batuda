import { apiBaseUrl } from './api-base'

/**
 * Session gate used by the root route's `beforeLoad`.
 *
 * Calls Better-Auth's `/auth/get-session` and returns the user (or
 * `null`). Base URL resolution lives in `api-base.ts`; on SSR the
 * caller forwards the incoming request's `Cookie` header via
 * `getServerCookieHeader()`. We narrow that header to the `batuda.*`
 * cookie family before forwarding so unrelated browser cookies
 * (third-party scripts, dev tooling, sibling apps) never leave the
 * SSR runtime.
 *
 * We don't use `BatudaApiAtom` / `HttpApiClient` here because the auth
 * routes are untyped passthroughs and this runs before any atoms are
 * instantiated — a plain fetch keeps the gate free of Effect runtime.
 */

const AUTH_COOKIE_PATTERN = /^(?:__Secure-|__Host-)?batuda[._-]/

function filterAuthCookies(header: string): string {
	return header
		.split(';')
		.map(s => s.trim())
		.filter(c => {
			const eq = c.indexOf('=')
			const name = eq === -1 ? c : c.slice(0, eq)
			return AUTH_COOKIE_PATTERN.test(name)
		})
		.join('; ')
}

export type SessionUser = {
	readonly id: string
	readonly email: string
	readonly name: string
}

/**
 * Resolve the current session, or `null` if there isn't one (or the
 * call failed). Never throws — callers treat `null` as "not logged in"
 * and redirect to `/login`.
 *
 * `cookieHeader` must be provided on SSR (loaders cannot read
 * `document.cookie`); on the client, pass `undefined` and rely on
 * `credentials: 'include'`.
 */
export async function fetchSession(
	cookieHeader: string | undefined,
): Promise<SessionUser | null> {
	const base = apiBaseUrl()
	if (typeof window === 'undefined' && !base) return null
	try {
		const headers: Record<string, string> = { accept: 'application/json' }
		if (cookieHeader) {
			const filtered = filterAuthCookies(cookieHeader)
			if (filtered) headers['cookie'] = filtered
		}
		const res = await fetch(`${base}/auth/get-session`, {
			method: 'GET',
			headers,
			credentials: 'include',
		})
		if (!res.ok) return null
		const body = (await res.json()) as unknown
		if (body === null || typeof body !== 'object') return null
		const maybeUser = (body as { user?: unknown }).user
		if (!maybeUser || typeof maybeUser !== 'object') return null
		const u = maybeUser as { id?: unknown; email?: unknown; name?: unknown }
		if (typeof u.id !== 'string' || typeof u.email !== 'string') return null
		return {
			id: u.id,
			email: u.email,
			name: typeof u.name === 'string' ? u.name : u.email,
		}
	} catch (err) {
		if (typeof window === 'undefined' && err instanceof TypeError) {
			console.error('[session-check] SSR fetch failed:', err.message)
		}
		return null
	}
}
