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

/* Owns the active locale for the whole app. `initialLang` comes from
 * the root route context (server-parsed cookie), so SSR and the first
 * client render agree. On mount we reconcile against localStorage in
 * case the cookie was cleared — one extra render only when they
 * disagree, which is the exception after the first `setLang` call
 * writes both storages. */
export function LangProvider({
	initialLang,
	children,
}: {
	initialLang: LangCode
	children: ReactNode
}) {
	const [lang, setLangState] = useState<LangCode>(initialLang)

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
