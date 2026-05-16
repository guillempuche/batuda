import { apiBaseUrl } from './api-base'

/**
 * Composes Better Auth's `/auth/get-session` and `/auth/list-accounts`
 * into the two booleans the profile card and nudge banner render against.
 * No custom server route: `passwordOptOut` rides on the user payload as
 * a `user.additionalFields` column, and `hasPassword` is derived from
 * the credential row in `/auth/list-accounts`.
 *
 * SSR branching mirrors `fetchSession`: server callers pass an explicit
 * `Cookie` header (loaders can't read `document.cookie`); browser callers
 * pass `undefined` and rely on `credentials: 'include'`.
 */

const AUTH_COOKIE_PATTERN = /^(?:__Secure-|__Host-)?batuda[._-]/

function filterAuthCookies(header: string): string {
	return header
		.split(';')
		.map(cookie => cookie.trim())
		.filter(cookie => {
			const eq = cookie.indexOf('=')
			const name = eq === -1 ? cookie : cookie.slice(0, eq)
			return AUTH_COOKIE_PATTERN.test(name)
		})
		.join('; ')
}

export interface SecurityState {
	readonly hasPassword: boolean
	readonly passwordOptOut: boolean
}

interface AccountSummary {
	readonly providerId?: unknown
}

export async function fetchSecurityState(
	cookieHeader: string | undefined,
): Promise<SecurityState | null> {
	const base = apiBaseUrl()
	if (typeof window === 'undefined' && !base) return null
	const headers: Record<string, string> = { accept: 'application/json' }
	if (cookieHeader) {
		const filtered = filterAuthCookies(cookieHeader)
		if (filtered) headers['cookie'] = filtered
	}
	try {
		const [sessionRes, accountsRes] = await Promise.all([
			fetch(`${base}/auth/get-session`, {
				method: 'GET',
				headers,
				credentials: 'include',
			}),
			fetch(`${base}/auth/list-accounts`, {
				method: 'GET',
				headers,
				credentials: 'include',
			}),
		])
		if (!sessionRes.ok || !accountsRes.ok) return null
		const sessionBody = (await sessionRes.json()) as unknown
		if (
			!sessionBody ||
			typeof sessionBody !== 'object' ||
			!('user' in sessionBody)
		) {
			return null
		}
		const user = (sessionBody as { user?: { passwordOptOut?: unknown } }).user
		if (!user || typeof user !== 'object') return null

		const accountsBody = (await accountsRes.json()) as unknown
		if (!Array.isArray(accountsBody)) return null
		const hasPassword = (accountsBody as AccountSummary[]).some(
			account => account.providerId === 'credential',
		)
		return {
			hasPassword,
			passwordOptOut: user.passwordOptOut === true,
		}
	} catch {
		return null
	}
}

/**
 * Flip the `passwordOptOut` flag on the current user. `/auth/update-user`
 * refreshes the session cookie's cached user record in the same response,
 * so the next `fetchSession` sees the new value with no separate invalidation.
 */
export async function setPasswordOptOut(optOut: boolean): Promise<boolean> {
	const base = apiBaseUrl()
	const res = await fetch(`${base}/auth/update-user`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json',
		},
		body: JSON.stringify({ passwordOptOut: optOut }),
	})
	return res.ok
}

export interface SetPasswordResult {
	readonly ok: boolean
	readonly code?: string
}

/**
 * Bind a first password for the current session. Returns a code-keyed
 * result (mirroring Better Auth's `{ code, message }` body) so the caller
 * can render a locale-stable error without parsing the human message.
 */
export async function setFirstPassword(
	newPassword: string,
): Promise<SetPasswordResult> {
	const base = apiBaseUrl()
	const res = await fetch(`${base}/auth/set-password`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json',
		},
		body: JSON.stringify({ newPassword }),
	})
	if (res.ok) return { ok: true }
	try {
		const body = (await res.json()) as { code?: unknown }
		if (typeof body.code === 'string') {
			return { ok: false, code: body.code }
		}
		return { ok: false }
	} catch {
		return { ok: false }
	}
}
