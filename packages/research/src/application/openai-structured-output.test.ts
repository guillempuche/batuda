import { OpenAiStructuredOutput, Tool } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { schemaRegistry } from './schemas/index'
import { researchToolkit } from './tools'

describe('researchToolkit', () => {
	it('should register at least one tool', () => {
		// GIVEN the live toolkit
		// THEN the loop below covers a non-empty set — an empty toolkit would
		// otherwise register zero "it" blocks and pass with no coverage
		expect(Object.keys(researchToolkit.tools).length).toBeGreaterThan(0)
	})

	describe('when converting each Phase-1 tool schema for OpenAI structured output', () => {
		for (const tool of Object.values(researchToolkit.tools)) {
			it(`should convert "${tool.name}" params without throwing`, () => {
				// GIVEN a Phase-1 tool's parameter schema
				// WHEN it is converted through the same path prepareTools uses (Tool.getJsonSchema + toCodecOpenAI)
				// THEN it does not throw — a Schema.optional field would hit "Unsupported AST Undefined"
				expect(() =>
					Tool.getJsonSchema(tool, {
						transformer: OpenAiStructuredOutput.toCodecOpenAI,
					}),
				).not.toThrow()
			})
		}
	})
})

describe('schemaRegistry', () => {
	it('should register at least one schema', () => {
		// GIVEN the live registry
		// THEN the loop below covers a non-empty set — an empty registry would
		// otherwise register zero "it" blocks and pass with no coverage
		expect(Object.keys(schemaRegistry).length).toBeGreaterThan(0)
	})

	describe('when converting each Phase-2 output schema for OpenAI structured output', () => {
		for (const [name, schema] of Object.entries(schemaRegistry)) {
			it(`should convert "${name}" without throwing`, () => {
				// GIVEN a registered Phase-2 output schema
				// WHEN it is converted through the same path generateObject uses (Tool.getJsonSchemaFromSchema + toCodecOpenAI)
				// THEN it does not throw — a Schema.optional field would hit "Unsupported AST
				// Undefined", and a Schema.Unknown field "Unsupported AST Unknown"
				expect(() =>
					Tool.getJsonSchemaFromSchema(schema, {
						transformer: OpenAiStructuredOutput.toCodecOpenAI,
					}),
				).not.toThrow()
			})
		}
	})
})
