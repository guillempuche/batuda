/* Ordered list of locales Batuda serves. Used by the language selector and
 * anywhere code needs to branch on a validated code. Catalog files live at
 * `src/locales/{en,ca}/messages.po` and are resolved through `./lingui`. */
export const langCodes = ['en', 'ca'] as const
export type LangCode = (typeof langCodes)[number]

/* SSR default when no cookie/localStorage preference is present — English
 * is the baseline; the client swaps to the user's actual preference from
 * the `LangProvider` on hydration. */
export const defaultLang: LangCode = 'en'

/* BCP-47 region tags for the `<html lang>` attribute — regional variant
 * tags help screen readers and search engines pick the right voice. */
export const htmlLang: Record<LangCode, string> = {
	en: 'en-US',
	ca: 'ca-ES',
}

export function isLangCode(value: unknown): value is LangCode {
	return (
		typeof value === 'string' &&
		(langCodes as readonly string[]).includes(value)
	)
}
