import { Schema } from 'effect'

// Languages Batuda serves, in the order a picker should show them. Everything
// keyed by a language — an email template, a message catalog — narrows to this
// list first, so a lookup can never come up empty.
export const LANG_CODES = ['en', 'ca'] as const
export const LangCode = Schema.Literals(LANG_CODES)
export type LangCode = typeof LangCode.Type

// Checks a value that arrives from outside the type system — a database
// column, an older client — before it is used as a key. Anything that fails
// counts as "no language chosen".
export function isLangCode(value: unknown): value is LangCode {
	return (
		typeof value === 'string' &&
		(LANG_CODES as readonly string[]).includes(value)
	)
}
