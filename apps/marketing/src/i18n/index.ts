import { ca } from './ca'
import { en } from './en'
import { es } from './es'

export type { Locale } from './ca'

export const locales = { ca, es, en } as const
export type LangCode = keyof typeof locales
/* SSR-rendered default. English is the baseline for a global audience —
 * the client swaps to the user's actual preference on hydration via the
 * detection logic in `lang-provider`. */
export const defaultLang: LangCode = 'en'
export const langCodes = ['ca', 'es', 'en'] as const

/* BCP-47 region tags for the <html lang> attribute. The internal LangCode
 * is just the language; this map adds the region so screen readers and
 * search engines see Castilian (Spain) rather than ambiguous "es". */
export const htmlLang: Record<LangCode, string> = {
	ca: 'ca-ES',
	es: 'es-ES',
	en: 'en-US',
}

export function isLangCode(value: unknown): value is LangCode {
	return (
		typeof value === 'string' &&
		(langCodes as readonly string[]).includes(value)
	)
}
