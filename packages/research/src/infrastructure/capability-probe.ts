/**
 * Capability probe for any OpenAI-compatible model endpoint.
 *
 * The research pipeline leans on two provider features that not every open-weights
 * model supports: forced tool calling (the agent tier sends `tool_choice`) and
 * strict JSON-schema structured output (the extract tier). Vendors differ on both —
 * some document `tool_choice: "auto"` and a forced-function form but not
 * `"required"`, and flag JSON-schema support per model card — so before trusting a
 * model in a tier, we check the two round-trips actually work against the live
 * endpoint. Point it at whichever vendor a tier is configured to use.
 *
 * The caller supplies the tools to probe with, so a check can reproduce the request
 * a research run really makes.
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

/**
 * Why a check came out the way it did.
 *
 * The distinction that matters is between a model that cannot do what a tier
 * needs and everything else. Only the first is a reason to stop trusting the
 * model; an expired key, a rate limit or a vendor having a bad minute say
 * nothing about it, and treating those the same way turns a passing outage into
 * a false accusation.
 */
export type ProbeVerdict =
	| 'ok'
	/** The model itself will not do it — the answer will be the same tomorrow. */
	| 'capability'
	/** The key was refused, so nothing about the model was learned. */
	| 'auth'
	/** Too many requests, or the account is out of allowance. */
	| 'quota'
	/** The request never got a usable answer back. */
	| 'transport'
	/** A refusal that fits none of the above; treated as worth a human look. */
	| 'unknown'

/** One capability's verdict: did the round-trip work, and a short human reason. */
export interface ProbeCheck {
	readonly ok: boolean
	readonly detail: string
	readonly verdict: ProbeVerdict
	/** The HTTP status behind the verdict, when the request reached the vendor. */
	readonly status?: number
}

/** Both capability verdicts for one model, plus whether it clears the gate (both ok). */
export interface ModelProbeResult {
	readonly model: string
	readonly toolChoice: ProbeCheck
	readonly jsonSchema: ProbeCheck
	readonly passed: boolean
}

const pass = (detail: string): ProbeCheck => ({
	ok: true,
	detail,
	verdict: 'ok',
})

// Answering at all and answering badly are both the model's own doing, so a
// reply that came back 200 and still fell short is a capability verdict.
const fail = (
	detail: string,
	verdict: ProbeVerdict = 'capability',
	status?: number,
): ProbeCheck => ({
	ok: false,
	detail,
	verdict,
	...(status === undefined ? {} : { status }),
})

/**
 * What a refused request says about the model.
 *
 * A 404 is the model being gone, which is as good a reason to stop trusting it
 * as a refusal. A 401 or 403 is about the key. A 429 is about how fast we asked.
 * Anything from the vendor's own side says nothing at all. A plain 400 usually
 * is the model declining the request, but not always — a model that needs terms
 * accepted answers exactly the same way — so the body decides.
 */
export const verdictForStatus = (
	status: number,
	body: string,
): ProbeVerdict => {
	if (status === 401 || status === 403) return 'auth'
	if (status === 429) return 'quota'
	if (status >= 500) return 'transport'
	if (status === 404) return 'capability'
	if (status === 400) {
		const lower = body.toLowerCase()
		const aboutTheModel =
			lower.includes('does not support') ||
			lower.includes('not supported') ||
			lower.includes('unsupported')
		if (aboutTheModel) return 'capability'
		if (lower.includes('terms') || lower.includes('quota')) return 'unknown'
		return 'capability'
	}
	return 'unknown'
}

/**
 * The chat-completions body that forces the model to call a tool.
 *
 * Pass the tools a research run really sends: a provider can accept a simple
 * made-up tool and still refuse the real ones, which would report a false pass.
 */
export const toolChoiceProbeBody = (
	model: string,
	tools: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> => ({
	model,
	messages: [
		{
			role: 'user',
			content:
				'Find the official website of Brompton Bicycle, the London bike maker. Use the available tools.',
		},
	],
	tools,
	tool_choice: 'required',
	// A ceiling, not a target. It only exists so a model that never stops
	// writing cannot run up a bill; it has to clear the room a reasoning model
	// spends thinking before it answers, or the answer is cut off mid-word and
	// the model is blamed for it.
	max_tokens: 4096,
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
	max_tokens: 4096,
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
			// Enough of the body to carry the vendor's own words, which is what
			// separates "this model will not do it" from "your key expired".
			const snippet = JSON.stringify(json ?? '').slice(0, 600)
			return fail(
				`HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
				verdictForStatus(response.status, snippet),
				response.status,
			)
		}
		return classify(json)
	}).pipe(
		Effect.catchCause(cause =>
			Effect.succeed(fail(Cause.pretty(cause).slice(0, 300), 'transport')),
		),
		// A model that never answers would otherwise hold up whatever is waiting
		// on the probe. Generous, because these models routinely think for the
		// better part of a minute before saying anything.
		Effect.timeoutOrElse({
			duration: '45 seconds',
			orElse: () =>
				Effect.succeed(fail('no answer within 45 seconds', 'transport')),
		}),
	)

/**
 * Probe one model's two required capabilities against an OpenAI-compatible endpoint.
 * Requires an `HttpClient`; never fails — each capability is reported as a check.
 */
export const probeModelCapabilities = (input: {
	readonly baseUrl: string
	readonly apiKey: Redacted.Redacted<string>
	readonly model: string
	readonly tools: ReadonlyArray<Record<string, unknown>>
}): Effect.Effect<ModelProbeResult, never, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const url = `${input.baseUrl.replace(/\/$/, '')}/chat/completions`
		const toolChoice = yield* runCheck(
			client,
			url,
			input.apiKey,
			toolChoiceProbeBody(input.model, input.tools),
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
