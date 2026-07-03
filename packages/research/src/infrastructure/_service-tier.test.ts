import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { Cause, Effect, Exit, Layer, Option } from 'effect'
import { AiError } from 'effect/unstable/ai'
import {
	HttpClient,
	type HttpClientError,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { stripNullServiceTier, tolerateNullServiceTier } from './_service-tier'

// ── Test helpers ──

// A chat-completion body shaped like the Qwen endpoint's, parameterized on the
// value it reports for `service_tier`.
const chatCompletionBody = (serviceTier: unknown): string =>
	JSON.stringify({
		id: 'chatcmpl-1',
		model: 'Qwen/Qwen3-32B',
		created: 0,
		choices: [
			{
				index: 0,
				finish_reason: 'stop',
				message: { role: 'assistant', content: 'hi there' },
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
		service_tier: serviceTier,
	})

// A one-shot HttpClient that answers every request with a canned body, so the
// real `@effect/ai-openai-compat` decode path runs against a controlled payload.
const cannedClient = (
	body: string,
	contentType = 'application/json',
): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.map(effect, request =>
				HttpClientResponseNs.fromWeb(
					request,
					new Response(body, {
						status: 200,
						headers: { 'content-type': contentType },
					}),
				),
			),
		Effect.succeed,
	)

const createResponse = (client: OpenAiClient.Service) =>
	client.createResponse({
		model: 'Qwen/Qwen3-32B',
		messages: [{ role: 'user', content: 'hi' }],
	})

const decodeThrough = (
	body: string,
	transformClient?: (c: HttpClient.HttpClient) => HttpClient.HttpClient,
) =>
	Effect.gen(function* () {
		const client = yield* OpenAiClient.make({
			apiUrl: 'http://qwen.test/v1',
			transformClient,
		})
		return yield* createResponse(client)
	}).pipe(Effect.provideService(HttpClient.HttpClient, cannedClient(body)))

// Build the tier LanguageModel exactly as `llm-live.ts` buildSlot does — real
// OpenAiLanguageModel over a wrapped OpenAiClient — but with the canned client
// swapped in for the network, then run one non-streaming generateText.
const generateThrough = (body: string) =>
	Effect.gen(function* () {
		const model = yield* OpenAiLanguageModel.make({ model: 'Qwen/Qwen3-32B' })
		return yield* model.generateText({ prompt: 'hi' })
	}).pipe(
		Effect.provide(
			OpenAiClient.layer({
				apiUrl: 'http://qwen.test/v1',
				transformClient: tolerateNullServiceTier,
			}).pipe(
				Layer.provide(Layer.succeed(HttpClient.HttpClient, cannedClient(body))),
			),
		),
	)

describe('stripNullServiceTier', () => {
	describe('when the provider sends service_tier as null', () => {
		it('should drop the field and return the re-serialized body', () => {
			// GIVEN a body whose service_tier is null (the Qwen behavior)
			const body = JSON.stringify({ id: 'x', service_tier: null, foo: 1 })

			// WHEN the body is sanitized
			// THEN service_tier is gone and the remaining fields keep their order
			expect(stripNullServiceTier(body)).toBe(
				JSON.stringify({ id: 'x', foo: 1 }),
			)
		})
	})

	describe('when there is nothing to strip', () => {
		it('should return undefined for a string service_tier', () => {
			// GIVEN a valid string service_tier (real OpenAI shape)
			const body = JSON.stringify({ id: 'x', service_tier: 'default' })

			// THEN the sanitizer signals "no change" so the caller reuses the body
			expect(stripNullServiceTier(body)).toBeUndefined()
		})

		it('should return undefined when service_tier is absent', () => {
			// GIVEN a body without the field at all
			// THEN there is nothing to strip
			expect(stripNullServiceTier(JSON.stringify({ id: 'x' }))).toBeUndefined()
		})
	})

	describe('when the body is not a JSON object', () => {
		it('should return undefined for a non-JSON string', () => {
			// GIVEN a body that is not JSON (e.g. an HTML error page)
			// THEN parsing fails and the sanitizer reports no change
			expect(stripNullServiceTier('<html>bad gateway</html>')).toBeUndefined()
		})

		it('should return undefined for a JSON array', () => {
			// GIVEN a top-level JSON array
			// THEN it has no service_tier key to strip
			expect(stripNullServiceTier('[1,2,3]')).toBeUndefined()
		})

		it('should return undefined for a JSON null literal', () => {
			// GIVEN the literal `null` — typeof null is "object", so the guard
			// against null is what saves the caller here
			expect(stripNullServiceTier('null')).toBeUndefined()
		})
	})
})

describe('tolerateNullServiceTier', () => {
	describe('when the OpenAI-compatible client decodes a response with service_tier: null', () => {
		it('should decode successfully once the client is wrapped', async () => {
			// GIVEN the Qwen endpoint answering with service_tier: null
			const body = chatCompletionBody(null)

			// WHEN the research LLM client wraps its HttpClient with the sanitizer
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateNullServiceTier),
			)

			// THEN the response decodes instead of failing at ["service_tier"]
			expect(decoded.id).toBe('chatcmpl-1')
			expect(decoded.choices[0]?.message?.content).toBe('hi there')
		})

		it('should fail without the wrapper, proving the wrapper is the fix', async () => {
			// GIVEN the same service_tier: null body but no sanitizer
			const body = chatCompletionBody(null)

			// WHEN the unwrapped client tries to decode it
			const exit = await Effect.runPromiseExit(decodeThrough(body))

			// THEN decode fails with an AiError naming the offending field
			expect(Exit.isFailure(exit)).toBe(true)
			const error = Exit.isFailure(exit)
				? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
				: undefined
			expect(error).toBeInstanceOf(AiError.AiError)
			expect(String((error as AiError.AiError | undefined)?.message)).toContain(
				'service_tier',
			)
		})
	})

	describe('when the assembled research LanguageModel runs generateText', () => {
		it('should return the generated text past a service_tier: null response', async () => {
			// GIVEN the tier model wired exactly as llm-live.ts builds it, answering
			// with service_tier: null
			const body = chatCompletionBody(null)

			// WHEN the agent tier generates text (the first research LLM call)
			const response = await Effect.runPromise(generateThrough(body))

			// THEN the run gets its text instead of stalling on a decode failure
			expect(response.text).toBe('hi there')
		})
	})

	describe('when the response already carries a valid service_tier', () => {
		it('should leave the body untouched and still decode', async () => {
			// GIVEN a string service_tier that the library accepts as-is
			const body = chatCompletionBody('default')

			// WHEN it flows through the wrapper (the strip is a no-op)
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateNullServiceTier),
			)

			// THEN the field survives — reusing the original response is safe
			expect(decoded.service_tier).toBe('default')
			expect(decoded.choices[0]?.message?.content).toBe('hi there')
		})
	})

	describe('when the response is a Server-Sent Events stream', () => {
		it('should pass the stream through without buffering or altering it', async () => {
			// GIVEN an SSE body that itself contains service_tier: null
			const sse = 'data: {"id":"1","service_tier":null}\n\ndata: [DONE]\n\n'
			const wrapped = tolerateNullServiceTier(
				cannedClient(sse, 'text/event-stream'),
			)

			// WHEN a request runs through the wrapped client
			const seen = await Effect.runPromise(
				wrapped.get('http://qwen.test/v1/chat/completions').pipe(
					Effect.flatMap(response =>
						Effect.map(response.text, text => ({
							contentType: response.headers['content-type'],
							text,
						})),
					),
				),
			)

			// THEN the event-stream body is delivered verbatim — the sanitizer never
			// touches a stream (research only calls the non-streaming paths)
			expect(seen.contentType).toBe('text/event-stream')
			expect(seen.text).toBe(sse)
		})
	})
})
