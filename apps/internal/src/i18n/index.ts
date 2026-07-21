import type { LangCode } from '@batuda/domain'

/* The list of languages lives in the domain package: the server stores each
 * person's language on their account and writes email in it, so both sides
 * have to agree on the same values. Catalog files live at
 * `src/locales/{en,ca}/messages.po` and are resolved through `./lingui`. */
export { isLangCode, LANG_CODES, LangCode } from '@batuda/domain'

/* SSR default when no stored preference is present — English is the baseline;
 * the client swaps to the person's actual preference from the `LangProvider`
 * on hydration. */
export const defaultLang: LangCode = 'en'

/* BCP-47 region tags for the `<html lang>` attribute — regional variant
 * tags help screen readers and search engines pick the right voice. */
export const htmlLang: Record<LangCode, string> = {
	en: 'en-US',
	ca: 'ca-ES',
}
