import type { AttributeValue } from '@batuda/domain'

// Reading the `Schema.Unknown` bodies some endpoints answer with. Each surface
// narrows the raw JSON into the small shape it renders, and these are the
// steps every one of them starts with.

// A string field, or null when the row has none or it is not a string.
export function str(r: Record<string, unknown>, key: string): string | null {
	return typeof r[key] === 'string' ? (r[key] as string) : null
}

// The rows of a list answer: a bare array, or the `{ items: [...] }` envelope
// the list endpoints wrap one in. Anything else reads as no rows.
export function listItems(value: unknown): ReadonlyArray<unknown> {
	if (Array.isArray(value)) return value
	if (
		value &&
		typeof value === 'object' &&
		Array.isArray((value as Record<string, unknown>)['items'])
	) {
		return (value as Record<string, unknown>)['items'] as ReadonlyArray<unknown>
	}
	return []
}

// Whether a raw value is one an attribute may hold: text, a finite number or
// a yes/no. A stored 0, false or empty string counts; a null, an object or a
// number that is not one does not.
export const isAttributeValue = (v: unknown): v is AttributeValue =>
	typeof v === 'string' ||
	typeof v === 'boolean' ||
	(typeof v === 'number' && Number.isFinite(v))
