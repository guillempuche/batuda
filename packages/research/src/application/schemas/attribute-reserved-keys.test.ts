import { Tool } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { ATTRIBUTE_RESERVED_KEYS } from '@batuda/domain'

import { schemaRegistry } from './index'

// Every property name a findings schema uses, at any depth: the names inside a
// row, a contact, a proposed change, a fit check.
const propertyNames = (schema: unknown): ReadonlySet<string> => {
	const names = new Set<string>()
	const walk = (node: unknown): void => {
		if (typeof node !== 'object' || node === null) return
		const record = node as Record<string, unknown>
		const properties = record['properties']
		if (typeof properties === 'object' && properties !== null) {
			for (const [name, child] of Object.entries(properties)) {
				names.add(name)
				walk(child)
			}
		}
		for (const key of ['items', 'additionalProperties']) walk(record[key])
		for (const key of ['anyOf', 'oneOf', 'allOf']) {
			const members = record[key]
			if (Array.isArray(members)) for (const member of members) walk(member)
		}
		const defs = record['$defs']
		if (typeof defs === 'object' && defs !== null)
			for (const child of Object.values(defs)) walk(child)
	}
	walk(schema)
	return names
}

describe('attribute keys against the findings schemas', () => {
	describe('when an organisation declares an attribute', () => {
		it('should never be able to take a name a findings schema already uses', () => {
			// GIVEN every field name across every findings schema, nested included
			const used = new Set<string>()
			for (const schema of Object.values(schemaRegistry))
				for (const name of propertyNames(Tool.getJsonSchemaFromSchema(schema)))
					used.add(name)

			// THEN each is reserved, so a value under it can never be mistaken for
			// the run's own field by the checks that act on a field by its name
			const unreserved = [...used].filter(
				name => !ATTRIBUTE_RESERVED_KEYS.has(name),
			)
			expect(unreserved).toEqual([])
		})
	})
})
