import { ATTRIBUTE_KINDS, type AttributeKind } from '@batuda/domain'

import { listItems, str } from '#/lib/narrow'

// The attribute endpoints answer with `Schema.Unknown` bodies like the rest of
// the instructions group, so the settings page, the company page and the list
// filter all read a declaration through this one narrowing.
export type AttributeDeclaration = {
	readonly id: string
	readonly stackId: string
	readonly stackName: string
	readonly key: string
	readonly label: string
	readonly kind: AttributeKind
	// The words a choice may take; empty for every other kind.
	readonly enumValues: ReadonlyArray<string>
	readonly unit: string | null
	readonly description: string | null
	readonly isActive: boolean
	readonly createdAt: string | null
}

// Whether a raw value names a kind this build knows how to read and filter.
export const isKind = (value: unknown): value is AttributeKind =>
	typeof value === 'string' &&
	(ATTRIBUTE_KINDS as ReadonlyArray<string>).includes(value)

// One raw row, or null when it lacks what every surface keys, labels and
// types on. A kind the app does not know is dropped rather than rendered as
// text: its value could not be edited or filtered the right way.
function narrowAttribute(row: unknown): AttributeDeclaration | null {
	if (!row || typeof row !== 'object') return null
	const r = row as Record<string, unknown>
	const id = str(r, 'id')
	const stackId = str(r, 'stackId')
	const key = str(r, 'key')
	const label = str(r, 'label')
	const kind = r['kind']
	if (
		id === null ||
		stackId === null ||
		key === null ||
		label === null ||
		!isKind(kind)
	) {
		return null
	}
	const enumValues = Array.isArray(r['enumValues'])
		? r['enumValues'].filter((x): x is string => typeof x === 'string')
		: []
	return {
		id,
		stackId,
		stackName: str(r, 'stackName') ?? '',
		key,
		label,
		kind,
		enumValues,
		unit: str(r, 'unit'),
		description: str(r, 'description'),
		isActive: r['isActive'] === true,
		createdAt: str(r, 'createdAt'),
	}
}

// listAttributes answers `{ items: [...] }`; a bare array is accepted too, the
// way the stack narrowing does, so a caller holding either shape reads it.
export function narrowAttributes(
	value: unknown,
): ReadonlyArray<AttributeDeclaration> {
	const out: Array<AttributeDeclaration> = []
	for (const row of listItems(value)) {
		const declaration = narrowAttribute(row)
		if (declaration !== null) out.push(declaration)
	}
	return out
}
