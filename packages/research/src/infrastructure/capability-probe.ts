/**
 * Capability probe for an OpenAI-compatible model endpoint (Nebius Token Factory).
 *
 * The research pipeline leans on two provider features that not every open-weights
 * model supports: forced tool calling (the agent tier sends `tool_choice`) and
 * strict JSON-schema structured output (the extract tier). Nebius documents
 * `tool_choice: "auto"` and a forced-function form but not `"required"`, and flags
 * JSON-schema support per model card — so before trusting a model in a tier, we
 * check the two round-trips actually work against the live endpoint.
 *
 * The request builders and response classifiers are pure so they can be unit-tested
 * without a network; only `probeModelCapabilities` touches the endpoint, and it maps
 * every failure (HTTP error, refusal, wrong shape) to a reported check rather than a
 * raised error, so probing a list of models never aborts partway.
 */

import { Cause, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

/** One capability's verdict: did the round-trip work, and a short human reason. */
export interface ProbeCheck {
	readonly ok: boolean
	readonly detail: string
}

/** Both capability verdicts for one model, plus whether it clears the gate (both ok). */
export interface ModelProbeResult {
	readonly model: string
	readonly toolChoice: ProbeCheck
	readonly jsonSchema: ProbeCheck
	readonly passed: boolean
}

const pass = (detail: string): ProbeCheck => ({ ok: true, detail })
const fail = (detail: string): ProbeCheck => ({ ok: false, detail })

/** The chat-completions body that forces the model to call a tool. */
export const toolChoiceProbeBody = (
	model: string,
): Record<string, unknown> => ({
	model,
	messages: [
		{
			role: 'user',
			content:
				'What is the current weather in Dallas, Texas? Use the available tool.',
		},
	],
	tools: [
		{
			type: 'function',
			function: {
				name: 'get_current_weather',
				description: 'Get the current weather in a given city',
				parameters: {
					type: 'object',
					properties: {
						city: { type: 'string' },
						state: { type: 'string' },
					},
					required: ['city', 'state'],
					additionalProperties: false,
				},
			},
		},
	],
	tool_choice: 'required',
})

/** The chat-completions body that forces a strict JSON-schema response. */
export const jsonSchemaProbeBody = (
	model: string,
): Record<string, unknown> => ({
	model,
	messages: [
		{
			role: 'system',
			content:
				'Reply with details of a real film the actor starred in, matching the schema.',
		},
		{ role: 'user', content: 'Jack Nicholson' },
	],
	response_format: {
		type: 'json_schema',
		json_schema: {
			name: 'film',
			strict: true,
			schema: {
				type: 'object',
				properties: {
					title: { type: 'string' },
					year: { type: 'number' },
				},
				required: ['title', 'year'],
				additionalProperties: false,
			},
		},
	},
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object'
		? (value as Record<string, unknown>)
		: null

// The assistant message inside the first choice, whatever else the body carries.
const firstMessage = (json: unknown): Record<string, unknown> | null => {
	const choices = asRecord(json)?.['choices']
	if (!Array.isArray(choices) || choices.length === 0) return null
	return asRecord(asRecord(choices[0])?.['message'])
}

/** Did the model emit a tool call when forced to? */
export const classifyToolChoiceResponse = (json: unknown): ProbeCheck => {
	const message = firstMessage(json)
	if (message === null) return fail('response had no choices[0].message')
	const toolCalls = message['tool_calls']
	if (Array.isArray(toolCalls) && toolCalls.length > 0) {
		const name = asRecord(asRecord(toolCalls[0])?.['function'])?.['name']
		return pass(`called ${typeof name === 'string' ? name : 'a function'}`)
	}
	return fail('model returned no tool_calls under a forced tool_choice')
}

/** Did the model return a valid JSON object under a strict schema (and not refuse)? */
export const classifyJsonSchemaResponse = (json: unknown): ProbeCheck => {
	const message = firstMessage(json)
	if (message === null) return fail('response had no choices[0].message')
	const refusal = message['refusal']
	if (typeof refusal === 'string' && refusal.length > 0) {
		return fail(`model refused: ${refusal}`)
	}
	const content = message['content']
	if (typeof content !== 'string' || content.trim().length === 0) {
		return fail('model returned empty content, not JSON')
	}
	try {
		const parsed: unknown = JSON.parse(content)
		const record = asRecord(parsed)
		if (record === null || Array.isArray(parsed)) {
			return fail('content parsed but was not a JSON object')
		}
		return pass(
			`returned a JSON object (keys: ${Object.keys(record).join(', ')})`,
		)
	} catch {
		return fail('content was not valid JSON')
	}
}

const runCheck = (
	client: HttpClient.HttpClient,
	url: string,
	apiKey: Redacted.Redacted<string>,
	body: Record<string, unknown>,
	classify: (json: unknown) => ProbeCheck,
): Effect.Effect<ProbeCheck> =>
	Effect.gen(function* () {
		const request = HttpClientRequest.post(url).pipe(
			HttpClientRequest.setHeaders({
				Authorization: `Bearer ${Redacted.value(apiKey)}`,
				Accept: 'application/json',
			}),
			HttpClientRequest.bodyJsonUnsafe(body),
		)
		const response = yield* client.execute(request)
		// A malformed reply is reported as a failed check, instead of crashing.
		const json = yield* HttpClientResponse.schemaBodyJson(Schema.Unknown)(
			response,
		).pipe(Effect.orElseSucceed(() => null))
		if (response.status < 200 || response.status >= 300) {
			const snippet = JSON.stringify(json ?? '').slice(0, 200)
			return fail(`HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`)
		}
		return classify(json)
	}).pipe(
		Effect.catchCause(cause =>
			Effect.succeed(fail(Cause.pretty(cause).slice(0, 200))),
		),
	)

/**
 * Probe one model's two required capabilities against an OpenAI-compatible endpoint.
 * Requires an `HttpClient`; never fails — each capability is reported as a check.
 */
export const probeModelCapabilities = (input: {
	readonly baseUrl: string
	readonly apiKey: Redacted.Redacted<string>
	readonly model: string
}): Effect.Effect<ModelProbeResult, never, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const url = `${input.baseUrl.replace(/\/$/, '')}/chat/completions`
		const toolChoice = yield* runCheck(
			client,
			url,
			input.apiKey,
			toolChoiceProbeBody(input.model),
			classifyToolChoiceResponse,
		)
		const jsonSchema = yield* runCheck(
			client,
			url,
			input.apiKey,
			jsonSchemaProbeBody(input.model),
			classifyJsonSchemaResponse,
		)
		return {
			model: input.model,
			toolChoice,
			jsonSchema,
			passed: toolChoice.ok && jsonSchema.ok,
		}
	})
