/**
 * Session gate used by the root route's `beforeLoad`.
 *
 * Calls Better-Auth's `/auth/get-session` endpoint against the API
 * server and returns a boolean. It is intentionally lightweight:
 *
 *   - On SSR, the caller forwards the incoming request's `cookie`
 *     header via `getRequestHeader('cookie')`.
 *   - On the client, the caller passes `undefined` and the browser's
 *     fetch automatically attaches the `forja.*` session cookie because
 *     we pass `credentials: 'include'` (requires CORS + credentials on
 *     the API, which `apps/server/src/main.ts` configures).
 *
 * We don't use `ForjaApiAtom` / `HttpApiClient` here because the auth
 * routes are untyped passthroughs and this runs before any atoms are
 * instantiated — a plain fetch keeps the gate free of Effect runtime.
 */

const SERVER_URL =
	(typeof import.meta !== 'undefined' &&
		import.meta.env?.['VITE_SERVER_URL']) ||
	''

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
	if (!SERVER_URL) return null // VITE_SERVER_URL must be set
	try {
		const headers: Record<string, string> = { accept: 'application/json' }
		if (cookieHeader) headers['cookie'] = cookieHeader
		const res = await fetch(`${SERVER_URL}/auth/get-session`, {
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
		if (
			typeof process !== 'undefined' &&
			process.versions?.node &&
			err instanceof TypeError
		) {
			console.error(
				'[session-check] SSR fetch failed — if TLS, run: portless trust',
			)
		}
		return null
	}
}
