import { defaultLang, isLangCode, type LangCode } from './index'

const STORAGE_KEY = 'engranatge.lang'

export function readStoredLang(): LangCode | null {
	if (typeof window === 'undefined') return null
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY)
		return isLangCode(stored) ? stored : null
	} catch {
		return null
	}
}

export function writeStoredLang(lang: LangCode): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(STORAGE_KEY, lang)
	} catch {
		/* localStorage may be unavailable (private mode, quota) — fail silently. */
	}
}

/* Walk the browser's preferred languages and pick the first Batuda serves.
 * Catalan (any region) → 'ca'; anything English-ish → 'en'. Returns null
 * if nothing matches so callers can apply their own fallback. */
export function detectBrowserLang(): LangCode | null {
	if (typeof navigator === 'undefined') return null
	const preferred =
		navigator.languages && navigator.languages.length > 0
			? navigator.languages
			: navigator.language
				? [navigator.language]
				: []

	for (const tag of preferred) {
		const base = tag.toLowerCase().split('-')[0]
		if (base === 'ca') return 'ca'
		if (base === 'en') return 'en'
	}
	return null
}

/* Single client-side entry point: localStorage → browser → default. On
 * the server this always yields `defaultLang` since there's no window or
 * navigator — the server path instead reads the cookie directly. */
export function detectLang(): LangCode {
	return readStoredLang() ?? detectBrowserLang() ?? defaultLang
}
