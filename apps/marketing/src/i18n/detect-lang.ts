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

/* Walk the browser's preferred languages and pick the first one we support.
 * Catalan (any region) → 'ca'. Spanish from Spain or any LATAM country → 'es'.
 * Anything English-ish → 'en'. Returns null if nothing matches so the caller
 * can apply its own fallback. */
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
		if (base === 'es') return 'es'
		if (base === 'en') return 'en'
	}
	return null
}

/* Single entry point for route beforeLoad: localStorage → browser → default.
 * Returns a concrete LangCode (never null) so redirects can always target
 * a valid URL. Server-side this always yields `defaultLang` since there's
 * no window / navigator. */
export function detectLang(): LangCode {
	return readStoredLang() ?? detectBrowserLang() ?? defaultLang
}
