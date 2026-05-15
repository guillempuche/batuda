/**
 * Normalizes an email read from form input. Trims surrounding whitespace
 * (browsers may paste with leading/trailing spaces) and lowercases the host
 * + local parts so login lookups stay consistent across casing variants.
 */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase()
