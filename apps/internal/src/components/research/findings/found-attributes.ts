import type { AttributeValue } from '@batuda/domain'
import { coerceAttributeValue } from '@batuda/domain'

import { resolveDeclarations } from '#/components/companies/attribute-rows'
import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import { isAttributeValue, str } from '#/lib/narrow'

/**
 * The attributes a run found, read off the findings as a reader is handed them.
 *
 * A run stores each value together with the page it was read on, and the way out
 * splits that in two: the value under its own key, the page under the same key
 * inside an `evidence` map beside them. So the map holds one entry per attribute
 * plus that one reserved name, and both halves are read back here into a row per
 * attribute.
 */

export type FoundAttribute = {
	readonly key: string
	readonly value: AttributeValue
	readonly sourceId: string | null
	readonly quote: string | null
}

const EVIDENCE_KEY = 'evidence'

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * One row per attribute the run filled, in the order the run wrote them.
 *
 * An entry holding nothing a person could read is left out rather than shown as
 * something it is not, and a map with only the evidence on it is no attributes at
 * all.
 */
export function narrowFoundAttributes(
	raw: unknown,
): ReadonlyArray<FoundAttribute> {
	if (!isObject(raw)) return []
	const beside = raw[EVIDENCE_KEY]
	const evidence = isObject(beside) ? beside : {}
	const out: Array<FoundAttribute> = []
	for (const [key, entry] of Object.entries(raw)) {
		if (key === EVIDENCE_KEY) continue
		// A value still sitting with its own page is read here too: nothing splits
		// the two when an attribute of this very name is declared, and the rest of
		// the map would then read as nothing at all.
		const paired =
			isObject(entry) && isAttributeValue(entry['value']) ? entry : null
		const value = paired === null ? entry : paired['value']
		if (!isAttributeValue(value)) continue
		const named = evidence[key]
		const page = isObject(named) ? named : paired
		out.push({
			key,
			value,
			sourceId: page === null ? null : str(page, 'source_id'),
			quote: page === null ? null : str(page, 'quote'),
		})
	}
	return out
}

/**
 * The found values that will actually be recorded, each read as the kind it was
 * declared with.
 *
 * A key nobody declares active right now is dropped, and so is a value that no
 * longer reads as its declared kind: the server writes neither, and a screen
 * promising them promises what will not happen. Not knowing what is declared is
 * not the same as nothing being declared — then every row is kept and the server
 * decides.
 */
export function declaredAttributes(
	found: ReadonlyArray<FoundAttribute>,
	declarations: ReadonlyArray<AttributeDeclaration> | null,
): ReadonlyArray<FoundAttribute> {
	if (declarations === null) return found
	const byKey = new Map(resolveDeclarations(declarations).map(d => [d.key, d]))
	const out: Array<FoundAttribute> = []
	for (const row of found) {
		const declaration = byKey.get(row.key)
		if (declaration === undefined) continue
		const value = coerceAttributeValue(
			declaration.kind,
			row.value,
			declaration.enumValues,
		)
		if (value === null) continue
		out.push({ ...row, value })
	}
	return out
}
