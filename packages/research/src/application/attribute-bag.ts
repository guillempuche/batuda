/**
 * Put a run's attribute values into the shape every reader expects.
 *
 * Extraction writes them as a list of entries — one `{ key, value, source_id,
 * quote }` per attribute — because a list is the one shape a model fills
 * reliably. Everything after extraction reads them as a map keyed by attribute
 * key, holding the same `{ value, source_id, quote }` pairing every other sourced
 * field uses, so the guards, the readers and the CRM column all see one shape.
 *
 * The first entry per key wins: a model naming a key twice has no better claim
 * the second time, and a stable choice keeps a run's answer the same on a
 * re-read. An empty list is no attributes at all, so the key goes; a map is
 * already settled and passes through untouched. A company profile carries the
 * map beside its other blocks; a scan carries one on each company it found.
 */

import { discoveryResultField, isDiscoveryScan } from './discovery-scan'
import { isPlainObject } from './guard-shapes'

export const ATTRIBUTES_FIELD = 'attributes'

export interface AttributeFold {
	readonly findings: unknown
	/** How many entries became a keyed value. */
	readonly folded: number
	/** How many entries were left out: a repeat of a key, or no key at all. */
	readonly dropped: number
}

const foldList = (
	entries: ReadonlyArray<unknown>,
): { readonly map: Record<string, unknown>; readonly dropped: number } => {
	const kept: Array<[string, Record<string, unknown>]> = []
	const seen = new Set<string>()
	let dropped = 0
	for (const entry of entries) {
		if (!isPlainObject(entry) || typeof entry['key'] !== 'string') {
			dropped++
			continue
		}
		const key = entry['key'].trim()
		if (key === '' || seen.has(key)) {
			dropped++
			continue
		}
		seen.add(key)
		const { key: _key, ...pairing } = entry
		// No confidence is asked of the model, and the pairing every reader expects
		// carries one, so it goes in empty.
		kept.push([key, { ...pairing, confidence: null }])
	}
	// Built from entries rather than by assigning keys: the keys are model-written,
	// and assigning one called `__proto__` reaches the prototype setter.
	return { map: Object.fromEntries(kept), dropped }
}

const foldHolder = (
	holder: Record<string, unknown>,
): {
	readonly holder: Record<string, unknown>
	readonly folded: number
	readonly dropped: number
} => {
	const raw = holder[ATTRIBUTES_FIELD]
	if (raw === undefined || isPlainObject(raw))
		return { holder, folded: 0, dropped: 0 }
	const { [ATTRIBUTES_FIELD]: _raw, ...rest } = holder
	if (!Array.isArray(raw)) return { holder: rest, folded: 0, dropped: 1 }
	const { map, dropped } = foldList(raw)
	const folded = Object.keys(map).length
	return folded === 0
		? { holder: rest, folded: 0, dropped }
		: { holder: { ...rest, [ATTRIBUTES_FIELD]: map }, folded, dropped }
}

export const foldAttributeEntries = (
	findings: unknown,
	schemaName: string,
): AttributeFold => {
	if (!isPlainObject(findings)) return { findings, folded: 0, dropped: 0 }
	if (!isDiscoveryScan(schemaName)) {
		const result = foldHolder(findings)
		return {
			findings: result.holder,
			folded: result.folded,
			dropped: result.dropped,
		}
	}
	const field = discoveryResultField(schemaName)
	const rows = field === undefined ? undefined : findings[field]
	if (field === undefined || !Array.isArray(rows))
		return { findings, folded: 0, dropped: 0 }
	let folded = 0
	let dropped = 0
	let changed = false
	const settled = rows.map(row => {
		if (!isPlainObject(row)) return row
		const result = foldHolder(row)
		folded += result.folded
		dropped += result.dropped
		if (result.holder !== row) changed = true
		return result.holder
	})
	return changed
		? { findings: { ...findings, [field]: settled }, folded, dropped }
		: { findings, folded, dropped }
}
