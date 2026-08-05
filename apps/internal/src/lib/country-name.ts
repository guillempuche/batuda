/**
 * Turn a stored country code into the name for it in the reader's language.
 *
 * Companies keep their country the way a form and a filter want it — "ES" — and
 * that is what used to reach the screen. The browser already knows every country
 * in every language we ship, so nothing has to be translated by hand here.
 *
 * Anything that is not a country code it recognises is handed back untouched:
 * a row holding something odd should show what it holds rather than vanish.
 */
export function countryName(
	code: string | null | undefined,
	locale: string,
): string | null {
	return displayName(code, locale, 'region', c => c.toUpperCase())
}

/** The same, for the language a page is written in. */
export function languageName(
	code: string | null | undefined,
	locale: string,
): string | null {
	return displayName(code, locale, 'language', c => c.toLowerCase())
}

function displayName(
	code: string | null | undefined,
	locale: string,
	type: 'region' | 'language',
	normalize: (code: string) => string,
): string | null {
	if (code === null || code === undefined || code === '') return null
	try {
		return new Intl.DisplayNames([locale], { type }).of(normalize(code)) ?? code
	} catch {
		return code
	}
}
