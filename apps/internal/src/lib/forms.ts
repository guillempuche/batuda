/**
 * Normalizes an email read from form input. Trims surrounding whitespace
 * (browsers may paste with leading/trailing spaces) and lowercases the host
 * + local parts so login lookups stay consistent across casing variants.
 */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase()

/**
 * A loose shape check — one `@` with something either side and no spaces —
 * so a form can say what is wrong in the app's own words instead of the
 * browser's. The server still decides whether the address is usable.
 */
export const isLikelyEmail = (value: string): boolean =>
	/^[^\s@]+@[^\s@]+$/.test(value)
