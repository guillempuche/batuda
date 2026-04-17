import { isLangCode, type LangCode } from './index'

const COOKIE_NAME = 'engranatge.lang'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/* Mirrors the localStorage choice into a cookie so the next SSR render
 * can pick the right catalog before first paint — without this, the
 * server always emits the default locale and hydration swaps to the
 * stored preference, flashing every translated string. */
export function writeLangCookie(lang: LangCode): void {
	if (typeof document === 'undefined') return
	// biome-ignore lint/suspicious/noDocumentCookie: this is the mirror that lets SSR pick the right catalog on first paint
	document.cookie = `${COOKIE_NAME}=${lang}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`
}

/* Parse `engranatge.lang=<code>` out of a raw `Cookie:` header. Returns
 * null when absent or unparseable so callers can fall back to the
 * default. */
export function readLangCookieFromHeader(
	cookieHeader: string | null | undefined,
): LangCode | null {
	if (!cookieHeader) return null
	const parts = cookieHeader.split(';')
	for (const part of parts) {
		const eq = part.indexOf('=')
		if (eq === -1) continue
		const name = part.slice(0, eq).trim()
		if (name !== COOKIE_NAME) continue
		const raw = part.slice(eq + 1).trim()
		const decoded = (() => {
			try {
				return decodeURIComponent(raw)
			} catch {
				return raw
			}
		})()
		return isLangCode(decoded) ? decoded : null
	}
	return null
}
