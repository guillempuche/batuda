import { createContext, use, useCallback, useEffect, useState } from 'react'

import {
	defaultLang,
	htmlLang,
	type LangCode,
	type Locale,
	langCodes,
	locales,
} from './index'

const STORAGE_KEY = 'engranatge.lang'

type LangContextValue = {
	lang: LangCode
	setLang: (next: LangCode) => void
}

const LangContext = createContext<LangContextValue>({
	lang: defaultLang,
	setLang: () => {},
})

function isLangCode(value: unknown): value is LangCode {
	return (
		typeof value === 'string' &&
		(langCodes as readonly string[]).includes(value)
	)
}

function readStoredLang(): LangCode | null {
	if (typeof window === 'undefined') return null
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY)
		return isLangCode(stored) ? stored : null
	} catch {
		return null
	}
}

/* Walk the browser's preferred languages and pick the first one we support.
 * Catalan (any region) → 'ca'. Spanish from Spain or any LATAM country → 'es'.
 * Anything English-ish → 'en'. Returns null if nothing matches so the caller
 * can apply its own fallback. */
function detectBrowserLang(): LangCode | null {
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

export function LangProvider({
	lang: initialLang,
	children,
}: {
	lang: LangCode
	children: React.ReactNode
}) {
	const [lang, setLangState] = useState<LangCode>(initialLang)

	/* Resolve the user's language on mount. Priority:
	 *   1. Explicit prior choice in localStorage
	 *   2. Browser-preferred language (Accept-Language)
	 *   3. English fallback
	 * We do this in an effect so the SSR output stays deterministic — the
	 * server always renders the static `initialLang`, and the client swaps
	 * to the resolved value during hydration. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: hydration-only effect; reading `lang` here would re-run on every change and undo user choice
	useEffect(() => {
		const stored = readStoredLang()
		if (stored) {
			if (stored !== lang) setLangState(stored)
			return
		}
		const detected = detectBrowserLang() ?? 'en'
		if (detected !== lang) setLangState(detected)
	}, [])

	/* Keep <html lang> in sync so screen readers and translation tools see
	 * the same language as the rendered UI. We use the BCP-47 region tag
	 * (e.g. 'es-ES') so the SSR default and runtime values stay consistent. */
	useEffect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.lang = htmlLang[lang]
		}
	}, [lang])

	const setLang = useCallback((next: LangCode) => {
		setLangState(next)
		try {
			window.localStorage.setItem(STORAGE_KEY, next)
		} catch {
			/* localStorage may be unavailable (private mode, quota) — fail silently. */
		}
	}, [])

	return <LangContext value={{ lang, setLang }}>{children}</LangContext>
}

export function useLang(): LangCode {
	return use(LangContext).lang
}

export function useSetLang(): (next: LangCode) => void {
	return use(LangContext).setLang
}

export function useTranslations(): Locale {
	const lang = useLang()
	return locales[lang]
}
