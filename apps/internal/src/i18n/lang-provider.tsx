import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useState,
} from 'react'

import { writeLangCookie } from './cookie'
import { readStoredLang, writeStoredLang } from './detect-lang'
import { defaultLang, htmlLang, type LangCode } from './index'
import { LinguiProvider } from './lingui'

type LangContextValue = {
	lang: LangCode
	setLang: (next: LangCode) => void
}

const LangContext = createContext<LangContextValue>({
	lang: defaultLang,
	setLang: () => {},
})

/* Owns the active language for the whole app. `initialLang` is resolved in the
 * root route so SSR and the first client render agree: an explicit choice from
 * the switcher wins, then the language stored on the account, then the
 * default. On mount it reconciles against localStorage in case the cookie was
 * cleared — only `setLang` ever writes that key, so anything found there is a
 * choice the person made themselves and rightly outranks their account's
 * language. Someone who never picked has nothing stored. */
export function LangProvider({
	initialLang,
	children,
}: {
	initialLang: LangCode
	children: ReactNode
}) {
	const [lang, setLangState] = useState<LangCode>(initialLang)

	// Follow `initialLang` when it changes. Password sign-in is a client-side
	// navigation that never remounts this component, so `<html lang>` would flip
	// to the account's language while every string stayed in the previous one —
	// an English page announcing itself as Catalan to a screen reader.
	// (Magic-link sign-in does a full page load and never hits this.) Adjusting
	// during render rather than in an effect avoids painting the wrong language
	// first.
	const [syncedInitialLang, setSyncedInitialLang] =
		useState<LangCode>(initialLang)
	if (initialLang !== syncedInitialLang) {
		setSyncedInitialLang(initialLang)
		setLangState(initialLang)
	}

	const setLang = useCallback((next: LangCode) => {
		setLangState(next)
		writeStoredLang(next)
		writeLangCookie(next)
		if (typeof document !== 'undefined') {
			document.documentElement.lang = htmlLang[next]
		}
	}, [])

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only reconcile against localStorage
	useEffect(() => {
		const stored = readStoredLang()
		if (stored && stored !== lang) {
			setLang(stored)
		}
	}, [])

	return (
		<LangContext value={{ lang, setLang }}>
			<LinguiProvider lang={lang}>{children}</LinguiProvider>
		</LangContext>
	)
}

export function useLang(): LangCode {
	return use(LangContext).lang
}

export function useSetLang(): (next: LangCode) => void {
	return use(LangContext).setLang
}
