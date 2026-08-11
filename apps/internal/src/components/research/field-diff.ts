/**
 * Turning a proposed change into "what the record says now" versus "what it
 * would say", so someone deciding on it can see what a value replaces instead of
 * only the new value. Kept free of JSX so it can be unit-tested plainly.
 */

// From the module itself, not the package's front door: the front door carries
// the whole research context — the service, its database client, its providers —
// and pulling that into a browser bundle stops the page coming alive.
import { unwrapValue } from '@batuda/research/application/guard-shapes'

/** Handled elsewhere on the row, so they are left out of the value list. */
const SKIPPED_FIELDS = new Set(['name', 'channels', 'companyId', 'company_id'])

export type FieldChange = {
	readonly key: string
	/** What the record holds now, or null when it holds nothing yet. */
	readonly from: string | null
	readonly to: string
	/** The new value matches what is already there, so nothing would change. */
	readonly unchanged: boolean
}

/** A value as a person would read it, or null when there is nothing to show. */
export function displayValue(value: unknown): string | null {
	// A value can arrive on its own, or paired with the page it was read from.
	// Both mean the same thing to a reader, so the pairing is read past before
	// anything is shown — otherwise the row displays the pairing itself.
	const v = unwrapValue(value)
	if (v === null || v === undefined) return null
	if (typeof v === 'string') return v.trim() === '' ? null : v
	if (typeof v === 'number' || typeof v === 'boolean') return String(v)
	if (Array.isArray(v)) {
		const parts = v.map(displayValue).filter((x): x is string => x !== null)
		return parts.length > 0 ? parts.join(', ') : null
	}
	return null
}

/** The same field name written the other way round, for looking up the record. */
function snakeCase(key: string): string {
	return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function currentFor(
	current: Record<string, unknown> | null,
	key: string,
): unknown {
	if (current === null) return undefined
	if (key in current) return current[key]
	const snake = snakeCase(key)
	return snake in current ? current[snake] : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

/**
 * Pair each proposed value with what the record holds for it today. A field the
 * record has nothing for reads as an addition; one that already matches is
 * marked so it can be played down rather than presented as a change.
 */
export function fieldChanges(
	fields: unknown,
	subjectCurrent: unknown,
): ReadonlyArray<FieldChange> {
	const proposed = asRecord(fields)
	if (proposed === null) return []
	const current = asRecord(subjectCurrent)
	const out: Array<FieldChange> = []
	for (const [key, raw] of Object.entries(proposed)) {
		if (SKIPPED_FIELDS.has(key)) continue
		const to = displayValue(raw)
		if (to === null) continue
		const from = displayValue(currentFor(current, key))
		out.push({ key, from, to, unchanged: from === to })
	}
	return out
}

/** Contact points carry their own trust marks, so they are read out separately. */
export type ProposedChannel = {
	readonly kind: string
	readonly value: string
	readonly verification: string | null
}

export function proposedChannels(
	fields: unknown,
): ReadonlyArray<ProposedChannel> {
	const proposed = asRecord(fields)
	const raw = proposed?.['channels']
	if (!Array.isArray(raw)) return []
	const out: Array<ProposedChannel> = []
	for (const item of raw) {
		const c = asRecord(item)
		if (c === null) continue
		const value = displayValue(c['value'])
		if (typeof c['kind'] !== 'string' || value === null) continue
		out.push({
			kind: c['kind'],
			value,
			verification:
				typeof c['verification'] === 'string' ? c['verification'] : null,
		})
	}
	return out
}

/**
 * A field name as a person would read it: "sizeRange" and "size_range" both
 * become "Size range". A proper name for each field belongs in the shared label
 * list; until every field has one, this keeps the raw wire spelling off screen.
 */
export function humanizeFieldKey(key: string): string {
	const spaced = key
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.trim()
		.toLowerCase()
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
