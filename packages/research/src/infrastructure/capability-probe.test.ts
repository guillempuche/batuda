import { Effect, Redacted } from 'effect'
import {
	HttpClient,
	type HttpClientError,
	type HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import {
	classifyJsonSchemaResponse,
	classifyToolChoiceResponse,
	jsonSchemaProbeBody,
	probeModelCapabilities,
	toolChoiceProbeBody,
	verdictForStatus,
} from './capability-probe'

// The body groq returns when the model called the tool but filled its arguments
// in wrongly — copied from a real run, because the exact wording is what tells
// this apart from a vendor saying the model cannot call tools at all.
const TOOL_CALL_DID_NOT_VALIDATE = JSON.stringify({
	error: {
		message:
			"Tool call validation failed: parameters for tool web_search did not match schema: errors: [missing properties: 'limit', additionalProperties 'topn' not allowed]",
		type: 'invalid_request_error',
		code: 'tool_use_failed',
	},
})

const CALLED_A_TOOL = JSON.stringify({
	choices: [
		{ message: { tool_calls: [{ function: { name: 'web_search' } }] } },
	],
})

const RETURNED_JSON = JSON.stringify({
	choices: [{ message: { content: '{"title":"a","year":1}' } }],
})

/**
 * A client that answers with the given replies in order, counting how many times
 * it was asked. The last reply repeats once the script runs out, so a test only
 * has to write the answers it cares about.
 */
const scriptedClient = (
	replies: ReadonlyArray<{ status: number; body: string }>,
	asked: { count: number },
): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.flatMap(effect, (request: HttpClientRequest.HttpClientRequest) => {
				const reply = replies[asked.count] ?? replies[replies.length - 1]!
				asked.count += 1
				return Effect.succeed(
					HttpClientResponse.fromWeb(
						request,
						new Response(reply.body, { status: reply.status }),
					),
				)
			}),
		Effect.succeed,
	)

const probeWith = (client: HttpClient.HttpClient) =>
	Effect.runPromise(
		probeModelCapabilities({
			baseUrl: 'https://api.example.test/v1',
			apiKey: Redacted.make('test-key'),
			model: 'openai/gpt-oss-120b',
			tools: [{ type: 'function', function: { name: 'web_search' } }],
		}).pipe(Effect.provideService(HttpClient.HttpClient, client)),
	)

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

	describe('what a refused request says about the model', () => {
		describe('when the vendor refuses the request itself', () => {
			it('should blame the model when it says the feature is unsupported', () => {
				// GIVEN the refusal a model gives when it cannot do structured output
				const verdict = verdictForStatus(
					400,
					'{"error":{"message":"This model does not support response format `json_schema`."}}',
				)

				// WHEN classified — THEN it counts against the model, because the same
				// request will be refused the same way tomorrow
				expect(verdict).toBe('capability')
			})

			it('should not blame the model when the account has not accepted its terms', () => {
				// GIVEN the same status code, for a reason that says nothing about
				// whether the model can do the work
				const verdict = verdictForStatus(
					400,
					'{"error":{"message":"The model requires terms acceptance. Please have the org admin accept the terms."}}',
				)

				// WHEN classified — THEN it is held back for a person to look at,
				// rather than read as the model having gone bad
				expect(verdict).toBe('unknown')
			})

			it('should not blame the model when a tool call did not validate', () => {
				// GIVEN a refusal about the arguments this one answer chose — the
				// model did call the tool, it just filled it in wrongly, and the
				// next answer may well be right
				const verdict = verdictForStatus(400, TOOL_CALL_DID_NOT_VALIDATE)

				// WHEN classified — THEN it is held back for a person, because
				// nothing here says the model cannot do the work
				expect(verdict).toBe('unknown')
			})

			it('should blame the model when it is no longer served', () => {
				// GIVEN a model the vendor has retired
				// WHEN classified — THEN it counts against the model: gone is as good a
				// reason to stop trusting it as refusing
				expect(verdictForStatus(404, '{"error":"model_not_found"}')).toBe(
					'capability',
				)
			})
		})

		describe('when the refusal is about us, or about the vendor', () => {
			it('should separate a rejected key from a bad model', () => {
				// GIVEN a key the vendor will not accept
				// WHEN classified — THEN nothing was learned about the model
				expect(verdictForStatus(401, '{"error":"invalid api key"}')).toBe(
					'auth',
				)
				expect(verdictForStatus(403, '{"error":"forbidden"}')).toBe('auth')
			})

			it('should separate asking too fast from a bad model', () => {
				// GIVEN a rate limit
				// WHEN classified — THEN it is about how we asked, not what we asked
				expect(verdictForStatus(429, '{"error":"slow down"}')).toBe('quota')
			})

			it('should treat the vendor having a bad minute as telling us nothing', () => {
				// GIVEN the vendor's own side failing — the exact shape seen while a
				// primary model was intermittently unavailable
				// WHEN classified — THEN it must never be read as the model having
				// gone bad, or an outage would be recorded as a permanent verdict
				expect(verdictForStatus(500, '{"error":"InternalServerError"}')).toBe(
					'transport',
				)
				expect(verdictForStatus(502, 'Error processing request')).toBe(
					'transport',
				)
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

describe('probeModelCapabilities', () => {
	describe('when one answer fails and the next one works', () => {
		it('should report the capability as met', async () => {
			// GIVEN a model whose first tool call did not validate and whose
			// second one did — the same model answering twice, differently
			const asked = { count: 0 }
			const client = scriptedClient(
				[
					{ status: 400, body: TOOL_CALL_DID_NOT_VALIDATE },
					{ status: 200, body: CALLED_A_TOOL },
					{ status: 200, body: RETURNED_JSON },
				],
				asked,
			)

			// WHEN probed
			const result = await probeWith(client)

			// THEN the model is not blamed for the answer that went wrong
			expect(result.toolChoice.ok).toBe(true)
			expect(result.passed).toBe(true)
		})
	})

	describe('when every answer fails the same way', () => {
		it('should report the failure and say how many times it asked', async () => {
			// GIVEN a model that never produces a usable tool call
			const asked = { count: 0 }
			const client = scriptedClient(
				[{ status: 400, body: TOOL_CALL_DID_NOT_VALIDATE }],
				asked,
			)

			// WHEN probed
			const result = await probeWith(client)

			// THEN it is reported as failed, and the report says how hard we tried
			// so a reader can weigh it
			expect(result.toolChoice.ok).toBe(false)
			expect(result.toolChoice.detail).toContain('3 attempts')

			// AND it is still held back rather than counted against the model,
			// because the refusal never said the model cannot do the work
			expect(result.toolChoice.verdict).toBe('unknown')
		})
	})

	describe('when the vendor never gives a usable answer', () => {
		it('should ask once rather than spending the run on a slow vendor', async () => {
			// GIVEN the vendor's own side failing, which says nothing about the
			// model and is the slowest kind of answer to come back
			const asked = { count: 0 }
			const client = scriptedClient(
				[{ status: 503, body: '{"error":"upstream unavailable"}' }],
				asked,
			)

			// WHEN probed
			const result = await probeWith(client)

			// THEN each of the two capabilities was asked exactly once. Asking
			// again would multiply the slowest case by three, and the scheduled
			// check has a fixed slot of time to finish in.
			expect(asked.count).toBe(2)
			expect(result.toolChoice.verdict).toBe('transport')
		})
	})

	describe('when the key is refused', () => {
		it('should take that at its word rather than asking again', async () => {
			// GIVEN a vendor rejecting the key, which no amount of retrying fixes
			const asked = { count: 0 }
			const client = scriptedClient(
				[{ status: 401, body: '{"error":"invalid api key"}' }],
				asked,
			)

			// WHEN probed
			const result = await probeWith(client)

			// THEN each of the two capabilities was asked exactly once
			expect(asked.count).toBe(2)
			expect(result.toolChoice.verdict).toBe('auth')
		})
	})
})
