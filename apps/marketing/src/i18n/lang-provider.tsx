import { useRouter } from '@tanstack/react-router'
import { createContext, use, useCallback, useEffect } from 'react'

import { writeStoredLang } from './detect-lang'
import { defaultLang, htmlLang, isLangCode, type LangCode } from './index'

type LangContextValue = {
	lang: LangCode
	setLang: (next: LangCode) => void
}

const LangContext = createContext<LangContextValue>({
	lang: defaultLang,
	setLang: () => {},
})

export function LangProvider({
	lang,
	children,
}: {
	lang: LangCode
	children: React.ReactNode
}) {
	const router = useRouter()

	/* Keep <html lang> in sync client-side when lang changes via navigation.
	 * `__root.tsx` already sets this attribute server-side from the URL, so
	 * this effect is defensive — it catches cases where some imperative code
	 * updated the attribute directly and would otherwise drift. */
	useEffect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.lang = htmlLang[lang]
		}
	}, [lang])

	const setLang = useCallback(
		(next: LangCode) => {
			if (next === lang) return
			writeStoredLang(next)

			/* We navigate using the internal (canonical) path with the new
			 * lang segment swapped in. The slug stays as-is because it's
			 * already canonical English inside `router.state.location`; the
			 * output rewrite handles localising it back for the browser URL.
			 * `searchStr` keeps its leading '?' but `hash` is stripped of '#'
			 * by the router parser, so we re-prefix it before concatenation. */
			const { pathname, searchStr, hash } = router.state.location
			const segments = pathname.split('/').filter(Boolean)
			const rest = isLangCode(segments[0])
				? segments.slice(1).join('/')
				: segments.join('/')
			const nextPath = rest ? `/${next}/${rest}` : `/${next}`
			const hashStr = hash ? `#${hash}` : ''
			router.navigate({ href: `${nextPath}${searchStr}${hashStr}` })
		},
		[lang, router],
	)

	return <LangContext value={{ lang, setLang }}>{children}</LangContext>
}

export function useLang(): LangCode {
	return use(LangContext).lang
}

export function useSetLang(): (next: LangCode) => void {
	return use(LangContext).setLang
}
