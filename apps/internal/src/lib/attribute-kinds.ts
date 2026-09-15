import {
	type AttributeKind,
	type AttributeValue,
	isCalendarDay,
} from '@batuda/domain'

export type FormatAttributeOptions = {
	readonly locale: string
	// The unit written after a number, when the attribute declares one.
	readonly unit: string | null
	// Yes and no in the reader's words, for a yes/no value.
	readonly yes: string
	readonly no: string
}

// Building a formatter costs more than using one, and a page formats the same
// handful of locales row after row, so each is built once and kept.
const numberFormats = new Map<string, Intl.NumberFormat>()
const dayFormats = new Map<string, Intl.DateTimeFormat>()

function numberFormat(locale: string): Intl.NumberFormat {
	const kept = numberFormats.get(locale)
	if (kept !== undefined) return kept
	const made = new Intl.NumberFormat(locale)
	numberFormats.set(locale, made)
	return made
}

function dayFormat(locale: string): Intl.DateTimeFormat {
	const kept = dayFormats.get(locale)
	if (kept !== undefined) return kept
	const made = new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeZone: 'UTC',
	})
	dayFormats.set(locale, made)
	return made
}

// A stored value the way a person reads it: a number in the reader's digits
// with its unit after it, a day as a date, yes or no in the reader's words.
// Text and a choice word are shown as stored.
export function formatAttributeValue(
	kind: AttributeKind,
	value: AttributeValue,
	options: FormatAttributeOptions,
): string {
	switch (kind) {
		case 'number': {
			const text =
				typeof value === 'number'
					? numberFormat(options.locale).format(value)
					: String(value)
			return options.unit !== null && options.unit !== ''
				? `${text} ${options.unit}`
				: text
		}
		case 'boolean':
			if (value === true) return options.yes
			if (value === false) return options.no
			return String(value)
		case 'date':
			return typeof value === 'string' && isCalendarDay(value)
				? dayFormat(options.locale).format(new Date(`${value}T00:00:00Z`))
				: String(value)
		default:
			return String(value)
	}
}

const editFormats = new Map<string, Intl.NumberFormat>()

function editFormat(locale: string): Intl.NumberFormat {
	const kept = editFormats.get(locale)
	if (kept !== undefined) return kept
	// No thousands marks, since a box is short and they are the easiest thing to
	// mistype; every stored digit, since a box that rounded what it showed would
	// save the rounding back the moment anything else was changed.
	const made = new Intl.NumberFormat(locale, {
		useGrouping: false,
		maximumFractionDigits: 20,
	})
	editFormats.set(locale, made)
	return made
}

// A stored value as the text somebody edits. A number is written with the
// reader's own decimal mark — the box is read back with those same marks, so
// handing a Catalan reader "12.5" would be handing them something their own
// keyboard cannot hand back. Every other kind is edited as stored.
export function attributeEditText(
	kind: AttributeKind,
	value: AttributeValue,
	locale: string,
): string {
	return kind === 'number' && typeof value === 'number'
		? editFormat(locale).format(value)
		: String(value)
}

// The kind a value reads as when nothing declares its key any more, so it can
// still be shown the right way.
export function inferKind(value: AttributeValue): AttributeKind {
	if (typeof value === 'number') return 'number'
	if (typeof value === 'boolean') return 'boolean'
	return isCalendarDay(value) ? 'date' : 'text'
}
