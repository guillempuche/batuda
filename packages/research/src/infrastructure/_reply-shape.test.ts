import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { Cause, Effect, Exit, Layer, Option } from 'effect'
import { AiError } from 'effect/unstable/ai'
import {
	HttpClient,
	type HttpClientError,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { normalizeVendorReply, tolerateVendorReplyShape } from './_reply-shape'

// ── Test helpers ──

// A chat-completion reply carrying every field the library's response schema
// demands, in the shape the configured endpoints send.
const VALID_REPLY = {
	id: 'chatcmpl-1',
	model: 'Qwen/Qwen3-32B',
	created: 1786391439,
	choices: [
		{
			index: 0,
			finish_reason: 'stop',
			message: { role: 'assistant', content: 'hi there' },
		},
	],
	usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
} as const

// Build a reply body from that shape. An override of `undefined` omits the
// field, since JSON.stringify drops undefined values — which is how a vendor
// that never populates a field actually answers.
const replyBody = (overrides: Record<string, unknown> = {}): string =>
	JSON.stringify({ ...VALID_REPLY, ...overrides })

const parseBody = (body: string): Record<string, unknown> =>
	JSON.parse(body) as Record<string, unknown>

const nowInSeconds = (): number => Math.floor(Date.now() / 1000)

// A one-shot HttpClient that answers every request with a canned body, so the
// real `@effect/ai-openai-compat` decode path runs against a controlled payload.
const cannedClient = (
	body: string,
	contentType = 'application/json',
	extraHeaders: Record<string, string> = {},
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
						headers: { 'content-type': contentType, ...extraHeaders },
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
				transformClient: tolerateVendorReplyShape,
			}).pipe(
				Layer.provide(Layer.succeed(HttpClient.HttpClient, cannedClient(body))),
			),
		),
	)

const decodeFailureMessage = async (body: string): Promise<string> => {
	const exit = await Effect.runPromiseExit(decodeThrough(body))
	const error = Exit.isFailure(exit)
		? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
		: undefined
	expect(error).toBeInstanceOf(AiError.AiError)
	return String((error as AiError.AiError | undefined)?.message)
}

describe('normalizeVendorReply', () => {
	describe('when the payload is not a chat completion', () => {
		it('should report no change for a body that is not JSON', () => {
			// GIVEN a body that is not JSON at all (e.g. a gateway's HTML error page)
			// THEN parsing fails and the caller reuses the response untouched
			expect(normalizeVendorReply('<html>bad gateway</html>')).toBeUndefined()
		})

		it('should report no change for a JSON array', () => {
			// GIVEN a top-level JSON array
			// THEN it is not an object carrying reply fields
			expect(normalizeVendorReply('[1,2,3]')).toBeUndefined()
		})

		it('should report no change for a JSON null literal', () => {
			// GIVEN the literal `null` — typeof null is "object", so the guard
			// against null is what saves the caller here
			expect(normalizeVendorReply('null')).toBeUndefined()
		})

		it('should leave a vendor error body untouched', () => {
			// GIVEN an error payload from the same endpoint, which has no `choices`
			const body = JSON.stringify({ error: { message: 'rate limited' } })

			// THEN it is handed on exactly as it arrived rather than being given a
			// synthetic `created`
			expect(normalizeVendorReply(body)).toBeUndefined()
		})

		it('should leave a reply whose choices are not an array untouched', () => {
			// GIVEN `choices` present but not an array — nothing this can repair
			const body = replyBody({ choices: null })

			// THEN the body falls through to the library, which rejects it
			expect(normalizeVendorReply(body)).toBeUndefined()
		})
	})

	describe('when the reply already satisfies the response schema', () => {
		it('should report no change for a complete reply', () => {
			// GIVEN a reply carrying every required field
			// THEN there is nothing to repair
			expect(normalizeVendorReply(replyBody())).toBeUndefined()
		})

		it('should report no change for a string service_tier', () => {
			// GIVEN a string service_tier, which the library accepts as-is
			expect(
				normalizeVendorReply(replyBody({ service_tier: 'default' })),
			).toBeUndefined()
		})

		it('should report no change when the usage block is absent', () => {
			// GIVEN a vendor that reports no tokens at all — already how the library
			// represents "no usage"
			expect(
				normalizeVendorReply(replyBody({ usage: undefined })),
			).toBeUndefined()
		})

		it('should report no change when the usage block is null', () => {
			// GIVEN an explicitly null usage block, which the schema also accepts
			expect(normalizeVendorReply(replyBody({ usage: null }))).toBeUndefined()
		})

		it('should keep a created of zero rather than rewriting it', () => {
			// GIVEN created: 0 — an odd but decodable integer
			// THEN it survives, because only values the library would reject are
			// rewritten
			expect(normalizeVendorReply(replyBody({ created: 0 }))).toBeUndefined()
		})

		it('should keep an empty choices array untouched', () => {
			// GIVEN a reply with no choices to number
			// THEN there is no index to repair
			expect(normalizeVendorReply(replyBody({ choices: [] }))).toBeUndefined()
		})
	})

	describe('when the vendor sends service_tier as null', () => {
		it('should drop the field', () => {
			// GIVEN the null service_tier the Qwen endpoint sends
			const body = replyBody({ service_tier: null })

			// WHEN the reply is normalized
			const normalized = normalizeVendorReply(body)

			// THEN the field is gone, satisfying the "absent or a string" shape
			expect(normalized).toBeDefined()
			expect(parseBody(normalized?.body ?? '')).not.toHaveProperty(
				'service_tier',
			)
		})
	})

	describe('when the vendor omits created', () => {
		it('should fill it with the time the reply arrived', () => {
			// GIVEN a reply that never carried a created timestamp
			const before = nowInSeconds()

			// WHEN the reply is normalized
			const normalized = normalizeVendorReply(replyBody({ created: undefined }))
			const created = parseBody(normalized?.body ?? '')['created']

			// THEN it carries a whole-second timestamp from the moment it arrived
			expect(Number.isInteger(created)).toBe(true)
			expect(created as number).toBeGreaterThanOrEqual(before)
			expect(created as number).toBeLessThanOrEqual(nowInSeconds())
		})

		it('should replace a null created', () => {
			// GIVEN created sent as null rather than omitted
			const normalized = normalizeVendorReply(replyBody({ created: null }))

			// THEN it is filled the same way
			expect(
				Number.isInteger(parseBody(normalized?.body ?? '')['created']),
			).toBe(true)
		})

		it('should replace a created sent as a string', () => {
			// GIVEN a vendor stringifying its timestamp, which the Int schema rejects
			const normalized = normalizeVendorReply(
				replyBody({ created: '1786391439' }),
			)

			// THEN a decodable integer takes its place
			expect(
				Number.isInteger(parseBody(normalized?.body ?? '')['created']),
			).toBe(true)
		})

		it('should replace a fractional created', () => {
			// GIVEN a timestamp carrying milliseconds as a fraction of a second
			const normalized = normalizeVendorReply(
				replyBody({ created: 1786391439.5 }),
			)

			// THEN it is rounded down to the whole second the schema demands
			expect(
				Number.isInteger(parseBody(normalized?.body ?? '')['created']),
			).toBe(true)
		})
	})

	describe('when a choice omits its index', () => {
		it('should number the choice by its place in the array', () => {
			// GIVEN a single choice with no index
			const body = replyBody({
				choices: [{ message: { role: 'assistant', content: 'hi there' } }],
			})

			// WHEN the reply is normalized
			const choices = parseBody(normalizeVendorReply(body)?.body ?? '')[
				'choices'
			]

			// THEN it is numbered 0 — the position the library reads it from anyway
			expect(choices).toEqual([
				{ message: { role: 'assistant', content: 'hi there' }, index: 0 },
			])
		})

		it('should number every unnumbered choice in order', () => {
			// GIVEN several choices, none of them numbered
			const body = replyBody({
				choices: [
					{ message: { content: 'a' } },
					{ message: { content: 'b' } },
					{ message: { content: 'c' } },
				],
			})

			// WHEN the reply is normalized
			const choices = parseBody(normalizeVendorReply(body)?.body ?? '')[
				'choices'
			]

			// THEN each takes its own position, so the numbering stays consistent
			expect(
				(choices as ReadonlyArray<{ index: number }>).map(c => c.index),
			).toEqual([0, 1, 2])
		})

		it('should leave a numbering the vendor did send alone', () => {
			// GIVEN a first choice the vendor numbered oddly and a second with none
			const body = replyBody({
				choices: [
					{ index: 7, message: { content: 'a' } },
					{ message: { content: 'b' } },
				],
			})

			// WHEN the reply is normalized
			const choices = parseBody(normalizeVendorReply(body)?.body ?? '')[
				'choices'
			]

			// THEN the vendor's own number survives and only the gap is filled
			expect(
				(choices as ReadonlyArray<{ index: number }>).map(c => c.index),
			).toEqual([7, 1])
		})

		it('should replace a null index', () => {
			// GIVEN a choice whose index is null rather than absent
			const body = replyBody({
				choices: [{ index: null, message: { content: 'a' } }],
			})

			// THEN it is numbered by position like any other unusable value
			const choices = parseBody(normalizeVendorReply(body)?.body ?? '')[
				'choices'
			]
			expect((choices as ReadonlyArray<{ index: number }>)[0]?.index).toBe(0)
		})

		it('should leave a choice that is not an object alone', () => {
			// GIVEN a choices array holding something with no index to set
			const body = replyBody({ choices: ['not a choice'] })

			// THEN there is nothing to repair and the body falls through unchanged
			expect(normalizeVendorReply(body)).toBeUndefined()
		})
	})

	describe('when the usage block is short one counter', () => {
		it('should add up a missing total', () => {
			// GIVEN prompt and completion counts but no total
			const body = replyBody({
				usage: { prompt_tokens: 10, completion_tokens: 4 },
			})

			// WHEN the reply is normalized
			const usage = parseBody(normalizeVendorReply(body)?.body ?? '')['usage']

			// THEN the total is the two added together
			expect(usage).toEqual({
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
			})
		})

		it('should subtract a missing prompt count from the total', () => {
			// GIVEN a vendor reporting only the completion and the total
			const body = replyBody({
				usage: { completion_tokens: 4, total_tokens: 14 },
			})

			// WHEN the reply is normalized
			const usage = parseBody(normalizeVendorReply(body)?.body ?? '')['usage']

			// THEN the prompt count is solved from the equation the counters form
			expect(usage).toEqual({
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
			})
		})

		it('should subtract a missing completion count from the total', () => {
			// GIVEN a vendor reporting only the prompt and the total
			const body = replyBody({ usage: { prompt_tokens: 10, total_tokens: 14 } })

			// WHEN the reply is normalized
			const usage = parseBody(normalizeVendorReply(body)?.body ?? '')['usage']

			// THEN the completion count is solved the same way
			expect(usage).toEqual({
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
			})
		})

		it('should keep the vendor detail fields it does not understand', () => {
			// GIVEN a usage block short its total but carrying cache detail
			const body = replyBody({
				usage: {
					prompt_tokens: 10,
					completion_tokens: 4,
					prompt_tokens_details: { cached_tokens: 6 },
				},
			})

			// WHEN the reply is normalized
			const usage = parseBody(normalizeVendorReply(body)?.body ?? '')['usage']

			// THEN the detail survives, so cached-token reporting is not lost
			expect(usage).toEqual({
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
				prompt_tokens_details: { cached_tokens: 6 },
			})
		})

		it('should treat a counter sent as a string as one that is missing', () => {
			// GIVEN a total the Int schema would reject, with the other two usable
			const body = replyBody({
				usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: '14' },
			})

			// WHEN the reply is normalized
			const usage = parseBody(normalizeVendorReply(body)?.body ?? '')['usage']

			// THEN it is solved rather than left to fail decode
			expect(usage).toEqual({
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
			})
		})
	})

	describe('when the usage block cannot be solved', () => {
		it('should drop a block missing two counters', () => {
			// GIVEN only one counter, leaving nothing to solve the others from
			const body = replyBody({ usage: { prompt_tokens: 10 } })

			// WHEN the reply is normalized
			const normalized = parseBody(normalizeVendorReply(body)?.body ?? '')

			// THEN the block is dropped rather than zero-filled — reporting no usage
			// is a state callers bill as zero, an invented count would not be
			expect(normalized).not.toHaveProperty('usage')
		})

		it('should drop an empty usage block', () => {
			// GIVEN a usage object carrying no counters at all
			const normalized = parseBody(
				normalizeVendorReply(replyBody({ usage: {} }))?.body ?? '',
			)

			// THEN nothing can be recovered from it
			expect(normalized).not.toHaveProperty('usage')
		})

		it('should drop a block whose total is below the counter it reported', () => {
			// GIVEN a total smaller than the completion count, so the counters do not
			// form the equation this solves from
			const body = replyBody({
				usage: { completion_tokens: 20, total_tokens: 14 },
			})

			// WHEN the reply is normalized
			const normalized = parseBody(normalizeVendorReply(body)?.body ?? '')

			// THEN it is dropped rather than solved into a negative prompt count
			expect(normalized).not.toHaveProperty('usage')
		})

		it('should drop a usage block that is not an object', () => {
			// GIVEN usage sent as a scalar the schema cannot decode
			const normalized = parseBody(
				normalizeVendorReply(replyBody({ usage: 'none' }))?.body ?? '',
			)

			// THEN it is dropped so the rest of the reply still decodes
			expect(normalized).not.toHaveProperty('usage')
		})
	})

	describe('when several fields are missing at once', () => {
		it('should repair every one of them in a single pass', () => {
			// GIVEN a reply short its created, its choice index and its usage total
			const body = replyBody({
				created: undefined,
				choices: [{ message: { role: 'assistant', content: 'hi there' } }],
				usage: { prompt_tokens: 10, completion_tokens: 4 },
				service_tier: null,
			})

			// WHEN the reply is normalized
			const normalized = parseBody(normalizeVendorReply(body)?.body ?? '')

			// THEN no repair is skipped because an earlier one already succeeded
			expect(Number.isInteger(normalized['created'])).toBe(true)
			expect(normalized['choices']).toEqual([
				{ message: { role: 'assistant', content: 'hi there' }, index: 0 },
			])
			expect(normalized['usage']).toEqual({
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
			})
			expect(normalized).not.toHaveProperty('service_tier')
		})
	})

	describe('when reporting what it repaired', () => {
		it('should name the field it filled', () => {
			// GIVEN a reply short only its created
			// THEN the report names that field and nothing else
			expect(
				normalizeVendorReply(replyBody({ created: undefined }))?.repaired,
			).toEqual(['created'])
		})

		it('should name a solved usage block apart from a dropped one', () => {
			// GIVEN one usage block that can be solved and one that cannot
			const solvable = replyBody({
				usage: { prompt_tokens: 10, completion_tokens: 4 },
			})
			const unsolvable = replyBody({ usage: { prompt_tokens: 10 } })

			// THEN the report tells them apart, because only the dropped one costs
			// the run its token counts
			expect(normalizeVendorReply(solvable)?.repaired).toEqual(['usage'])
			expect(normalizeVendorReply(unsolvable)?.repaired).toEqual([
				'usage_dropped',
			])
		})

		it('should name every field when several were missing', () => {
			// GIVEN a reply short its service_tier, created, index and usage total
			const body = replyBody({
				service_tier: null,
				created: undefined,
				choices: [{ message: { content: 'hi there' } }],
				usage: { prompt_tokens: 10, completion_tokens: 4 },
			})

			// THEN each repair is reported, so a vendor's gaps are visible at once
			expect(normalizeVendorReply(body)?.repaired).toEqual([
				'service_tier',
				'created',
				'index',
				'usage',
			])
		})
	})
})

describe('tolerateVendorReplyShape', () => {
	describe('when the client decodes a reply the library would reject', () => {
		it('should decode a reply missing created once the client is wrapped', async () => {
			// GIVEN a vendor that never sends created
			const body = replyBody({ created: undefined })

			// WHEN the research LLM client wraps its HttpClient with the normalizer
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateVendorReplyShape),
			)

			// THEN the reply decodes and its content survives
			expect(decoded.choices[0]?.message?.content).toBe('hi there')
		})

		it('should fail on a missing created without the wrapper', async () => {
			// GIVEN the same reply but no normalizer
			// THEN decode fails with an AiError naming the offending field
			expect(
				await decodeFailureMessage(replyBody({ created: undefined })),
			).toContain('created')
		})

		it('should decode a choice missing its index once the client is wrapped', async () => {
			// GIVEN a vendor that numbers no choices
			const body = replyBody({
				choices: [{ message: { role: 'assistant', content: 'hi there' } }],
			})

			// WHEN the wrapped client decodes it
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateVendorReplyShape),
			)

			// THEN the choice arrives numbered by its position
			expect(decoded.choices[0]?.index).toBe(0)
			expect(decoded.choices[0]?.message?.content).toBe('hi there')
		})

		it('should fail on a missing choice index without the wrapper', async () => {
			// GIVEN the same reply but no normalizer
			const body = replyBody({
				choices: [{ message: { role: 'assistant', content: 'hi there' } }],
			})

			// THEN decode fails on the choice's index
			expect(await decodeFailureMessage(body)).toContain('index')
		})

		it('should decode a usage block short one counter once the client is wrapped', async () => {
			// GIVEN a vendor that omits the total it could have added up
			const body = replyBody({
				usage: { prompt_tokens: 10, completion_tokens: 4 },
			})

			// WHEN the wrapped client decodes it
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateVendorReplyShape),
			)

			// THEN the counters the vendor did send are still reported
			expect(decoded.usage).toEqual({
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
			})
		})

		it('should fail on a partial usage block without the wrapper', async () => {
			// GIVEN the same reply but no normalizer
			const body = replyBody({
				usage: { prompt_tokens: 10, completion_tokens: 4 },
			})

			// THEN decode fails on the counter the vendor left out
			expect(await decodeFailureMessage(body)).toContain('total_tokens')
		})

		it('should decode a reply whose usage cannot be solved', async () => {
			// GIVEN a usage block too incomplete to reconstruct
			const body = replyBody({ usage: { prompt_tokens: 10 } })

			// WHEN the wrapped client decodes it
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateVendorReplyShape),
			)

			// THEN the reply still yields its content, reporting no usage at all
			expect(decoded.choices[0]?.message?.content).toBe('hi there')
			expect(decoded.usage).toBeUndefined()
		})

		it('should decode a reply with a null service_tier', async () => {
			// GIVEN the Qwen endpoint answering with service_tier: null
			const body = replyBody({ service_tier: null })

			// WHEN the wrapped client decodes it
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateVendorReplyShape),
			)

			// THEN the reply decodes instead of failing at ["service_tier"]
			expect(decoded.id).toBe('chatcmpl-1')
			expect(decoded.choices[0]?.message?.content).toBe('hi there')
		})

		it('should fail on a null service_tier without the wrapper', async () => {
			// GIVEN the same reply but no normalizer
			// THEN decode fails naming the offending field
			expect(
				await decodeFailureMessage(replyBody({ service_tier: null })),
			).toContain('service_tier')
		})
	})

	describe('when the reply already decodes', () => {
		it('should leave the body untouched', async () => {
			// GIVEN a complete reply with a string service_tier
			const body = replyBody({ service_tier: 'default' })

			// WHEN it flows through the wrapper (every repair is a no-op)
			const [decoded] = await Effect.runPromise(
				decodeThrough(body, tolerateVendorReplyShape),
			)

			// THEN every field survives — reusing the original response is safe
			expect(decoded.service_tier).toBe('default')
			expect(decoded.created).toBe(VALID_REPLY.created)
			expect(decoded.usage).toEqual(VALID_REPLY.usage)
		})
	})

	describe('when the assembled research LanguageModel runs generateText', () => {
		it('should return the generated text past a reply missing several fields', async () => {
			// GIVEN the tier model wired exactly as llm-live.ts builds it, answering
			// with no created, an unnumbered choice and no usage total
			const body = replyBody({
				created: undefined,
				choices: [
					{
						finish_reason: 'stop',
						message: { role: 'assistant', content: 'hi there' },
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 4 },
			})

			// WHEN the agent tier generates text (the first research LLM call)
			const response = await Effect.runPromise(generateThrough(body))

			// THEN the run gets its text and the tokens it will be billed for
			expect(response.text).toBe('hi there')
			expect(response.usage.inputTokens.total).toBe(10)
			expect(response.usage.outputTokens.total).toBe(4)
		})

		it('should report no tokens when the usage block could not be solved', async () => {
			// GIVEN a reply whose usage is too incomplete to reconstruct
			const body = replyBody({ usage: { prompt_tokens: 10 } })

			// WHEN the tier model generates text
			const response = await Effect.runPromise(generateThrough(body))

			// THEN the text still arrives and the run bills nothing rather than an
			// invented count
			expect(response.text).toBe('hi there')
			expect(response.usage.inputTokens.total).toBeUndefined()
			expect(response.usage.outputTokens.total).toBeUndefined()
		})
	})

	describe('when the response is a Server-Sent Events stream', () => {
		it('should pass the stream through without buffering or altering it', async () => {
			// GIVEN an SSE body that itself omits created
			const sse = 'data: {"id":"1","choices":[]}\n\ndata: [DONE]\n\n'
			const wrapped = tolerateVendorReplyShape(
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

			// THEN the event-stream body is delivered verbatim — the normalizer never
			// touches a stream (research only calls the non-streaming paths)
			expect(seen.contentType).toBe('text/event-stream')
			expect(seen.text).toBe(sse)
		})
	})

	describe('when a repair changes the size of the body', () => {
		it('should not carry over the length the vendor reported', async () => {
			// GIVEN a reply needing repair, sent with a content-length header
			const body = replyBody({ created: undefined })
			const wrapped = tolerateVendorReplyShape(
				cannedClient(body, 'application/json', {
					'content-length': String(body.length),
				}),
			)

			// WHEN the wrapped client rewrites it
			const seen = await Effect.runPromise(
				wrapped
					.get('http://qwen.test/v1/chat/completions')
					.pipe(Effect.map(response => response.headers['content-length'])),
			)

			// THEN the stale size is gone, so nothing trusting the header misreads
			// the rewritten body
			expect(seen).not.toBe(String(body.length))
		})
	})
})
