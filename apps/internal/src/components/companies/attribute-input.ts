import {
	type AttributeKind,
	type AttributeValue,
	coerceAttributeValue,
} from '@batuda/domain'

/** What a typed box or a picked option means for the value filed under a key. */
export type AttributeInput =
	| { readonly outcome: 'clear' }
	| { readonly outcome: 'value'; readonly value: AttributeValue }
	| { readonly outcome: 'invalid' }

// The two marks a locale writes a number with: the one that groups thousands
// and the one that starts the decimals. Reading them out of Intl costs more
// than using them, so each locale is read once and kept.
type NumberMarks = {
	readonly group: string
	readonly decimal: string
}

const marksByLocale = new Map<string, NumberMarks>()

function numberMarks(locale: string): NumberMarks {
	const kept = marksByLocale.get(locale)
	if (kept !== undefined) return kept
	const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
	const made: NumberMarks = {
		// A locale that groups nothing has no group part. Falling back to the
		// comma keeps the expressions below working on a mark that cannot appear.
		group: parts.find(part => part.type === 'group')?.value ?? ',',
		decimal: parts.find(part => part.type === 'decimal')?.value ?? '.',
	}
	marksByLocale.set(locale, made)
	return made
}

const escapeMark = (mark: string): string =>
	mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A number read the way the reader's own screen writes one, as plain digits
 * with a dot — or null when it is not one.
 *
 * The same "1.200" is twelve hundred to a Catalan reader and one-point-two to an
 * English one, so the marks come from the locale rather than being guessed at.
 * A mark that groups is only dropped where the digits sit in threes, which is
 * what keeps "12,500" from meaning twelve and a half in English.
 */
export function readLocaleNumber(text: string, locale: string): string | null {
	const { group, decimal } = numberMarks(locale)
	// A space never means anything inside a number, and some locales group with
	// one, so they go before the marks are read.
	const bare = text.replace(/\s/g, '')
	const sign = bare.startsWith('-') ? '-' : ''
	const digits = sign === '' ? bare : bare.slice(1)
	const g = escapeMark(group)
	const d = escapeMark(decimal)
	const grouped = new RegExp(`^\\d{1,3}(?:${g}\\d{3})*(?:${d}\\d+)?$`)
	const ungrouped = new RegExp(`^\\d+(?:${d}\\d+)?$`)
	if (!grouped.test(digits) && !ungrouped.test(digits)) return null
	return `${sign}${digits.split(group).join('').replace(decimal, '.')}`
}

/**
 * An emptied box clears the key, anything the kind can read becomes the value,
 * and anything else is turned away here rather than by the server — which
 * answers with a reason nobody is looking at while the box is still open.
 */
export function readAttributeInput(
	kind: AttributeKind,
	raw: string | null,
	enumValues: ReadonlyArray<string>,
	locale: string,
): AttributeInput {
	const text = raw === null ? '' : raw.trim()
	if (text === '') return { outcome: 'clear' }
	if (kind === 'number') {
		const digits = readLocaleNumber(text, locale)
		if (digits === null) return { outcome: 'invalid' }
		const number = coerceAttributeValue(kind, digits, null)
		return number === null
			? { outcome: 'invalid' }
			: { outcome: 'value', value: number }
	}
	// A choice with no words left matches nothing, and that is what null says to
	// the reader below. Every other kind ignores the list.
	const value = coerceAttributeValue(
		kind,
		text,
		enumValues.length > 0 ? enumValues : null,
	)
	return value === null ? { outcome: 'invalid' } : { outcome: 'value', value }
}
