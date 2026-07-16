import { Effect, Ref } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { OpenAiStructuredOutput, Tool } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { ProviderError } from '../domain/errors'
import { withFallbackLanguageModel } from '../infrastructure/_harden'
import { schemaRegistry } from './schemas/index'
import { researchToolkit } from './tools'

// A single, non-nested union is what every configured provider accepts; a nested
// `anyOf` — an `anyOf` branch that is itself an `anyOf` — is what groq/fireworks
// reject ("anyOf branches must be disambiguated"). `optionalKey` around a
// `NullOr`, or a bare `Schema.Number` (its NaN/Infinity string branch), each
// produce that nesting. Walk the emitted schema and collect every such spot.
const nestedAnyOfPaths = (node: unknown, path = '$'): string[] => {
	if (Array.isArray(node)) {
		return node.flatMap((item, i) => nestedAnyOfPaths(item, `${path}[${i}]`))
	}
	if (node === null || typeof node !== 'object') return []
	const record = node as Record<string, unknown>
	const out: string[] = []
	const anyOf = record['anyOf']
	if (Array.isArray(anyOf)) {
		anyOf.forEach((branch, i) => {
			if (
				branch !== null &&
				typeof branch === 'object' &&
				'anyOf' in (branch as Record<string, unknown>)
			) {
				out.push(`${path}/anyOf/${i}`)
			}
		})
	}
	for (const [key, value] of Object.entries(record)) {
		out.push(...nestedAnyOfPaths(value, `${path}/${key}`))
	}
	return out
}

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

	describe('when serialising each Phase-1 tool schema for a strict provider', () => {
		for (const tool of Object.values(researchToolkit.tools)) {
			it(`should emit "${tool.name}" params with no nested anyOf`, () => {
				// GIVEN a Phase-1 tool's parameter schema
				// WHEN serialised through the exact runtime path (Tool.getJsonSchema + toCodecOpenAI)
				const jsonSchema = Tool.getJsonSchema(tool, {
					transformer: OpenAiStructuredOutput.toCodecOpenAI,
				})

				// THEN no union nests inside another union — the shape groq and
				// fireworks reject, which killed the LLM fallback in prod
				expect(nestedAnyOfPaths(jsonSchema)).toEqual([])
			})

			it(`should keep every "${tool.name}" argument's description`, () => {
				// GIVEN a Phase-1 tool's parameter schema
				// WHEN serialised through the exact runtime path
				const jsonSchema = Tool.getJsonSchema(tool, {
					transformer: OpenAiStructuredOutput.toCodecOpenAI,
				}) as { properties?: Record<string, { description?: string }> }

				// THEN each argument still explains itself — the model has nothing else
				// to go on, and a schema that lost a description is still a valid one,
				// so no other check here would notice
				for (const [name, property] of Object.entries(
					jsonSchema.properties ?? {},
				)) {
					expect(
						property.description,
						`${tool.name}.${name} lost its description`,
					).toBeTruthy()
				}
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

	describe('when serialising each Phase-2 output schema for a strict provider', () => {
		for (const [name, schema] of Object.entries(schemaRegistry)) {
			it(`should emit "${name}" with no nested anyOf`, () => {
				// GIVEN a registered Phase-2 output schema
				// WHEN serialised through the exact runtime path (Tool.getJsonSchemaFromSchema + toCodecOpenAI)
				const jsonSchema = Tool.getJsonSchemaFromSchema(schema, {
					transformer: OpenAiStructuredOutput.toCodecOpenAI,
				})

				// THEN no union nests inside another union — the extract tier's
				// fireworks fallback rejects that shape just as groq does for tools
				expect(nestedAnyOfPaths(jsonSchema)).toEqual([])
			})
		}
	})
})

// A stand-in for a strict provider (groq/fireworks): it serialises the real
// toolkit the way the production client does and refuses the turn if any tool
// carries a nested anyOf — exactly what killed the prod run. Otherwise it
// answers, so the composed model only completes when every tool is clean.
const strictProviderSlot = (
	reachedRef: Ref.Ref<boolean>,
): LanguageModel.Service =>
	({
		generateText: () =>
			Effect.gen(function* () {
				yield* Ref.set(reachedRef, true)
				for (const tool of Object.values(researchToolkit.tools)) {
					const jsonSchema = Tool.getJsonSchema(tool, {
						transformer: OpenAiStructuredOutput.toCodecOpenAI,
					})
					if (nestedAnyOfPaths(jsonSchema).length > 0) {
						return yield* Effect.fail(
							new ProviderError({
								provider: 'groq',
								message: `invalid JSON schema for tool ${tool.name}`,
								recoverable: false,
							}),
						)
					}
				}
				return { text: 'ok', usage: {} }
			}),
		generateObject: () => Effect.succeed({}),
		streamText: () => Effect.succeed({}),
	}) as unknown as LanguageModel.Service

const blippingSlot = (): LanguageModel.Service =>
	({
		generateText: () =>
			Effect.fail(
				new ProviderError({
					provider: 'nebius',
					message: 'transient blip',
					recoverable: true,
				}),
			),
		generateObject: () => Effect.succeed({}),
		streamText: () => Effect.succeed({}),
	}) as unknown as LanguageModel.Service

describe('LLM fallback with the real toolkit', () => {
	describe('when the primary slot fails and the fallback is a strict provider', () => {
		it('should complete the tool-calling turn on the fallback', async () => {
			// GIVEN a primary slot that fails and a strict-provider fallback that
			// rejects any nested-anyOf tool schema — the prod failure was that the
			// fallback (groq) refused the tools outright and the whole run died
			const reachedRef = Ref.makeUnsafe(false)
			const composed = withFallbackLanguageModel([
				blippingSlot(),
				strictProviderSlot(reachedRef),
			])

			// WHEN the cascade reaches the fallback and it serves a tool turn
			const result = await Effect.runPromise(
				(
					composed.generateText as unknown as (
						o: unknown,
					) => Effect.Effect<{ text: string }, ProviderError>
				)({ prompt: 'hi' }),
			)

			// THEN the fallback was reached AND it accepted the toolkit and answered
			expect(Ref.getUnsafe(reachedRef)).toBe(true)
			expect(result.text).toBe('ok')
		})
	})
})
