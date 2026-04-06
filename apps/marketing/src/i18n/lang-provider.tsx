import { createContext, use } from 'react'

import type { LangCode, Locale } from './index'
import { defaultLang, locales } from './index'

const LangContext = createContext<LangCode>(defaultLang)

export function LangProvider({
	lang,
	children,
}: {
	lang: LangCode
	children: React.ReactNode
}) {
	return <LangContext value={lang}>{children}</LangContext>
}

export function useLang(): LangCode {
	return use(LangContext)
}

export function useTranslations(): Locale {
	const lang = useLang()
	return locales[lang]
}
