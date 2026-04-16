/* The ordered list of locales the marketing site serves. Used by routing
 * (`$lang/route.tsx`), the language switcher, the sitemap, and anywhere
 * that needs to branch on a validated code. UI-string translations live
 * in `src/locales/{ca,es,en}/messages.po` and are resolved through the
 * Lingui runtime in `./lingui.tsx` — not from this file. */
export const langCodes = ['ca', 'es', 'en'] as const
export type LangCode = (typeof langCodes)[number]

/* SSR-rendered default. English is the baseline for a global audience —
 * the client swaps to the user's actual preference on hydration via the
 * detection logic in `lang-provider`. */
export const defaultLang: LangCode = 'en'

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
