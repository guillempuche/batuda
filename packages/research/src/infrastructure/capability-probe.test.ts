import { describe, expect, it } from 'vitest'

import {
	classifyJsonSchemaResponse,
	classifyToolChoiceResponse,
	jsonSchemaProbeBody,
	toolChoiceProbeBody,
} from './capability-probe'

describe('classifyToolChoiceResponse', () => {
	describe('when the model emitted a tool call', () => {
		it('should pass and name the called function', () => {
			// GIVEN a response where the model chose the weather tool
			const json = {
				choices: [
					{
						message: {
							tool_calls: [
								{ function: { name: 'get_current_weather', arguments: '{}' } },
							],
						},
					},
				],
			}

			// WHEN classified — THEN the forced tool call is confirmed
			const check = classifyToolChoiceResponse(json)
			expect(check.ok).toBe(true)
			expect(check.detail).toContain('get_current_weather')
		})
	})

	describe('when the model answered in prose instead of calling a tool', () => {
		it('should fail — forced tool choice was not honored', () => {
			// GIVEN a plain text answer with no tool_calls
			const json = {
				choices: [{ message: { content: 'It is sunny in Dallas.' } }],
			}

			// WHEN classified — THEN the capability is not met
			expect(classifyToolChoiceResponse(json).ok).toBe(false)
		})
	})

	describe('when the response has no choices', () => {
		it('should fail rather than throw', () => {
			// GIVEN a malformed / error body
			expect(classifyToolChoiceResponse({ error: 'bad request' }).ok).toBe(
				false,
			)
		})
	})
})

describe('classifyJsonSchemaResponse', () => {
	describe('when the model returned a valid JSON object', () => {
		it('should pass and list the keys', () => {
			// GIVEN schema-shaped JSON in the message content
			const json = {
				choices: [
					{
						message: {
							content: JSON.stringify({ title: 'The Shining', year: 1980 }),
						},
					},
				],
			}

			// WHEN classified — THEN structured output is confirmed
			const check = classifyJsonSchemaResponse(json)
			expect(check.ok).toBe(true)
			expect(check.detail).toContain('title')
		})
	})

	describe('when the model refused', () => {
		it('should fail and surface the refusal', () => {
			// GIVEN a refusal instead of content
			const json = {
				choices: [{ message: { refusal: 'I cannot help with that.' } }],
			}

			// WHEN classified — THEN it is a failure carrying the reason
			const check = classifyJsonSchemaResponse(json)
			expect(check.ok).toBe(false)
			expect(check.detail).toContain('refused')
		})
	})

	describe('when the content is not valid JSON', () => {
		it('should fail — the model ignored the schema', () => {
			// GIVEN prose where strict JSON was required
			const json = {
				choices: [{ message: { content: 'Here you go: The Shining (1980)' } }],
			}

			// WHEN classified — THEN it is a failure
			expect(classifyJsonSchemaResponse(json).ok).toBe(false)
		})
	})

	describe('when the content is valid JSON but not an object', () => {
		it('should fail — a bare array/string is not a schema object', () => {
			// GIVEN a JSON array in content
			const json = {
				choices: [{ message: { content: '["The Shining", 1980]' } }],
			}

			// WHEN classified — THEN it does not satisfy the object schema
			expect(classifyJsonSchemaResponse(json).ok).toBe(false)
		})
	})
})

describe('probe request bodies', () => {
	describe('toolChoiceProbeBody', () => {
		describe('when given the tools a run would send', () => {
			it('should force a tool call and pass those tools through untouched', () => {
				// GIVEN the caller's own tools
				const tools = [
					{ type: 'function', function: { name: 'web_search' } },
					{ type: 'function', function: { name: 'scrape_page' } },
				]

				// WHEN the probe body is built
				const body = toolChoiceProbeBody('openai/gpt-oss-120b', tools)

				// THEN it forces tool use and asks with exactly those tools — the
				// probe must not substitute a simpler stand-in of its own
				expect(body['model']).toBe('openai/gpt-oss-120b')
				expect(body['tool_choice']).toBe('required')
				expect(body['tools']).toEqual(tools)
			})
		})

		describe('when given no tools', () => {
			it('should leave the tool list empty rather than fall back to tools of its own', () => {
				// GIVEN a caller with an empty toolkit
				const body = toolChoiceProbeBody('openai/gpt-oss-120b', [])

				// WHEN built — THEN the tool list is empty, not a fabricated default
				expect(body['tools']).toEqual([])
			})
		})
	})

	describe('jsonSchemaProbeBody', () => {
		it('should request a strict json_schema response', () => {
			// GIVEN a target model
			const body = jsonSchemaProbeBody('Qwen/Qwen3-235B-A22B-Instruct-2507')

			// WHEN built — THEN it asks for strict schema-constrained JSON
			const responseFormat = body['response_format'] as {
				type: string
				json_schema: { strict: boolean }
			}
			expect(responseFormat.type).toBe('json_schema')
			expect(responseFormat.json_schema.strict).toBe(true)
		})
	})
})
