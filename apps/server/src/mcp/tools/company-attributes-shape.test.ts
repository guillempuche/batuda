import { Tool } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { CompanyTools } from './companies'

// The attribute values a company tool takes are a map of one flat choice per
// key. Some model providers refuse a choice nested inside another choice, so
// the published shape is pinned here rather than trusted.

type JsonSchema = Record<string, unknown>

const inputSchema = (name: 'create_companies' | 'update_company'): JsonSchema =>
	Tool.getJsonSchema(CompanyTools.tools[name]) as JsonSchema

const property = (
	schema: JsonSchema,
	...path: ReadonlyArray<string>
): JsonSchema => {
	let node: JsonSchema = schema
	for (const step of path) {
		const next = (
			node['properties'] as Record<string, JsonSchema> | undefined
		)?.[step]
		if (next === undefined)
			throw new Error(
				`no property ${step} under ${JSON.stringify(Object.keys(node))}`,
			)
		node = next
	}
	return node
}

const attributesShape = (
	name: 'create_companies' | 'update_company',
): JsonSchema =>
	name === 'create_companies'
		? property(
				property(inputSchema(name), 'companies')['items'] as JsonSchema,
				'attributes',
			)
		: property(inputSchema(name), 'attributes')

describe('the attributes parameter of the company tools', () => {
	describe.each([
		'create_companies',
		'update_company',
	] as const)('on %s', name => {
		it('should publish a map whose values are one flat choice', () => {
			// GIVEN the JSON schema a client receives for `attributes`
			const shape = attributesShape(name)

			// THEN it is an object of values, each a choice with no choice inside it
			expect(shape['type']).toBe('object')
			const value = shape['additionalProperties'] as JsonSchema
			const members = value['anyOf'] as ReadonlyArray<JsonSchema>
			expect(Array.isArray(members)).toBe(true)
			for (const member of members) {
				expect(member['anyOf']).toBeUndefined()
				expect(member['oneOf']).toBeUndefined()
			}
			// AND the choice covers text, a number, yes/no, the wrapped form and null
			const kinds = new Set(members.map(member => member['type']))
			for (const kind of ['string', 'number', 'boolean', 'object', 'null'])
				expect(kinds).toContain(kind)
		})

		it('should take the run the values came from beside them', () => {
			// GIVEN the tool's top-level parameters
			const top = inputSchema(name)
			// THEN research_id is offered and not required
			expect(property(top, 'research_id')['type']).toBe('string')
			expect((top['required'] as ReadonlyArray<string>) ?? []).not.toContain(
				'research_id',
			)
		})
	})
})
