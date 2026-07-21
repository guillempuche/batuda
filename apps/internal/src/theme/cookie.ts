import { isThemePreference, type ThemePreference } from './index'

const COOKIE_NAME = 'batuda.theme'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/* Mirrors the chosen theme into a cookie so the next SSR render can paint the
 * right one before first paint — without this, the server always emits the
 * light theme and the page flashes on every load.
 *
 * This stores the *preference*, so "system" is written as "system", never as
 * whatever the system happened to want at the time. Storing the resolved value
 * would quietly convert a system-following user into an explicit choice, with
 * no way back. */
export function writeThemeCookie(preference: ThemePreference): void {
	if (typeof document === 'undefined') return
	// biome-ignore lint/suspicious/noDocumentCookie: this is the mirror that lets SSR pick the right theme on first paint
	document.cookie = `${COOKIE_NAME}=${preference}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`
}

/* Parse `batuda.theme=<preference>` out of a raw `Cookie:` header. Returns
 * null when absent or unparseable so callers can fall back to the default. */
export function readThemeCookieFromHeader(
	cookieHeader: string | null | undefined,
): ThemePreference | null {
	if (!cookieHeader) return null
	for (const part of cookieHeader.split(';')) {
		const eq = part.indexOf('=')
		if (eq === -1) continue
		if (part.slice(0, eq).trim() !== COOKIE_NAME) continue
		const raw = part.slice(eq + 1).trim()
		const decoded = (() => {
			try {
				return decodeURIComponent(raw)
			} catch {
				return raw
			}
		})()
		return isThemePreference(decoded) ? decoded : null
	}
	return null
}
