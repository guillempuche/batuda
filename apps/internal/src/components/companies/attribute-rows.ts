import type { AttributeValue } from '@batuda/domain'

import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import { isAttributeValue, str } from '#/lib/narrow'

// One value as it sits under its key on the company: who set it and, for a
// value a research run read off a page, where and when.
export type StoredAttribute = {
	readonly value: AttributeValue
	readonly setBy: 'client' | 'research'
	readonly sourceUrl: string | null
	readonly quote: string | null
	readonly asOf: string | null
	readonly researchId: string | null
}

// The company's `attributes` column as stored, one entry per key. An entry
// without a readable value is left out rather than shown as something it is
// not; an entry that does not say who set it reads as a person's.
export function narrowCompanyAttributes(
	raw: unknown,
): ReadonlyMap<string, StoredAttribute> {
	const out = new Map<string, StoredAttribute>()
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
	for (const [key, entry] of Object.entries(raw)) {
		if (!entry || typeof entry !== 'object') continue
		const r = entry as Record<string, unknown>
		if (!isAttributeValue(r['value'])) continue
		out.set(key, {
			value: r['value'],
			setBy: r['set_by'] === 'research' ? 'research' : 'client',
			sourceUrl: str(r, 'source_url'),
			quote: str(r, 'quote'),
			asOf: str(r, 'as_of'),
			researchId: str(r, 'research_id'),
		})
	}
	return out
}

// Active declarations across every stack, one per key. Two stacks may declare
// the same key (its shape is pinned across the organisation), and a company
// shows it once. Sorted by stack name and then by creation so the order is the
// same whatever order the API returns them in.
export function resolveDeclarations(
	declarations: ReadonlyArray<AttributeDeclaration>,
): ReadonlyArray<AttributeDeclaration> {
	const sorted = declarations
		.filter(d => d.isActive)
		.sort(
			(a, b) =>
				a.stackName.localeCompare(b.stackName) ||
				(a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
		)
	const seen = new Set<string>()
	const out: Array<AttributeDeclaration> = []
	for (const declaration of sorted) {
		if (seen.has(declaration.key)) continue
		seen.add(declaration.key)
		out.push(declaration)
	}
	return out
}

export type AttributeRow = {
	readonly declaration: AttributeDeclaration
	readonly stored: StoredAttribute | null
}

export type OtherAttribute = {
	readonly key: string
	readonly stored: StoredAttribute
	// The declaration this key still has, retired or on no active stack, when
	// the list holds one. It carries the words and the kind the value was
	// written under, so a retired row keeps reading the way it always did.
	readonly declaration: AttributeDeclaration | null
}

// What the company page renders: a row per declared key, filled or not, then
// the values filed under keys nobody declares any more, which can be read and
// cleared but not edited.
export function attributeRows(
	declarations: ReadonlyArray<AttributeDeclaration>,
	values: ReadonlyMap<string, StoredAttribute>,
): {
	readonly declared: ReadonlyArray<AttributeRow>
	readonly other: ReadonlyArray<OtherAttribute>
} {
	const resolved = resolveDeclarations(declarations)
	const declared = resolved.map(declaration => ({
		declaration,
		stored: values.get(declaration.key) ?? null,
	}))
	const declaredKeys = new Set(resolved.map(d => d.key))
	const other = [...values]
		.filter(([key]) => !declaredKeys.has(key))
		.map(([key, stored]) => ({
			key,
			stored,
			declaration: declarations.find(d => d.key === key) ?? null,
		}))
	return { declared, other }
}

const ATTRIBUTE_PREFIX = 'attributes.'

// A field name from the company's provenance map as a person reads it: an
// attribute's entry is filed as `attributes.<key>`, and shows as its label, or
// its bare key when nothing declares it any more. Any other field is left as is.
export function provenanceLabel(
	field: string,
	declarations: ReadonlyArray<AttributeDeclaration>,
): string {
	if (!field.startsWith(ATTRIBUTE_PREFIX)) return field
	const key = field.slice(ATTRIBUTE_PREFIX.length)
	return declarations.find(d => d.key === key)?.label ?? key
}
