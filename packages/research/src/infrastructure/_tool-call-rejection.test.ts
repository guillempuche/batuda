import { Cause, Effect, Exit } from 'effect'
import { AiError } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { reclassifyRejectedToolCall } from './_tool-call-rejection'

// ── Test helpers ──

// What a provider that checks tool calls on its side actually sends back: an
// HTTP 400 the client reads as an invalid request, with the provider's own error
// code carried alongside under the OpenAI-compatible client's key.
const providerFailure = (reason: AiError.AiErrorReason): AiError.AiError =>
	new AiError.AiError({
		module: 'OpenAiClient',
		method: 'createResponse',
		reason,
	})

const REFUSAL_MESSAGE =
	"Tool call validation failed: parameters for tool web_search did not match schema: errors: [missing properties: 'limit', additionalProperties 'topn' not allowed]"

const invalidRequest = (
	description: string,
	metadata: Record<string, unknown> = {},
): AiError.AiError =>
	providerFailure(
		new AiError.InvalidRequestError({
			description,
			metadata,
		}),
	)

const refusedToolCall = (description = REFUSAL_MESSAGE): AiError.AiError =>
	invalidRequest(description, {
		openai: {
			errorCode: 'tool_use_failed',
			errorType: 'invalid_request_error',
			requestId: 'req_1',
		},
	})

// Run the failure through the combinator and hand back whatever it surfaced.
const reclassified = async (error: AiError.AiError): Promise<unknown> => {
	const exit = await Effect.runPromiseExit(
		reclassifyRejectedToolCall('groq', 'agent')(Effect.fail(error)),
	)
	return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
}

const reasonOf = (error: unknown): AiError.AiErrorReason | undefined =>
	error instanceof AiError.AiError ? error.reason : undefined

describe('reclassifyRejectedToolCall', () => {
	it('should re-raise a refused tool call as the retryable parameter error', async () => {
		// GIVEN a provider that refused the model's tool call for not matching the
		// tool's schema — the failure that used to end a run outright
		const error = refusedToolCall()

		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(error)

		// THEN it comes out as the error the library already retries
		// AND it is marked retryable, where the original was not
		expect(error.isRetryable).toBe(false)
		expect(reasonOf(surfaced)?._tag).toBe('ToolParameterValidationError')
		expect(
			surfaced instanceof AiError.AiError ? surfaced.isRetryable : undefined,
		).toBe(true)
	})

	it('should name the tool the provider refused', async () => {
		// GIVEN a refusal whose message names the tool
		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(refusedToolCall())

		// THEN the tool's name is carried onto the error
		// AND the provider's own wording is kept, so nothing about the refusal is lost
		const reason = reasonOf(surfaced)
		expect(
			reason?._tag === 'ToolParameterValidationError'
				? reason.toolName
				: undefined,
		).toBe('web_search')
		expect(
			reason?._tag === 'ToolParameterValidationError'
				? reason.description
				: undefined,
		).toBe(REFUSAL_MESSAGE)
	})

	it('should keep the module and method the provider client reported', async () => {
		// GIVEN a refusal raised by the OpenAI-compatible client
		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(refusedToolCall())

		// THEN where it came from still reads the same, so the logs stay diagnosable
		expect(
			surfaced instanceof AiError.AiError
				? `${surfaced.module}.${surfaced.method}`
				: undefined,
		).toBe('OpenAiClient.createResponse')
	})

	it('should still retry a refusal whose message names no tool', async () => {
		// GIVEN a refusal worded without a tool name
		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(
			refusedToolCall('Tool call validation failed'),
		)

		// THEN it is retried all the same, labelled as an unknown tool
		const reason = reasonOf(surfaced)
		expect(reason?._tag).toBe('ToolParameterValidationError')
		expect(
			reason?._tag === 'ToolParameterValidationError'
				? reason.toolName
				: undefined,
		).toBe('unknown')
	})

	it('should read the tool name past a lowercase "tool call" in the wording', async () => {
		// GIVEN a provider that words the same refusal in lower case, so the phrase
		// "tool call" reads to a pattern exactly like a tool being named
		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(
			refusedToolCall(
				'tool call validation failed: parameters for tool scrape_page did not match schema',
			),
		)

		// THEN the tool that was actually named is the one carried, not "call"
		const reason = reasonOf(surfaced)
		expect(
			reason?._tag === 'ToolParameterValidationError'
				? reason.toolName
				: undefined,
		).toBe('scrape_page')
	})

	it('should leave an invalid request carrying a different provider code alone', async () => {
		// GIVEN a 400 that really is a bad request — too long a prompt
		const error = invalidRequest('Please reduce the length of the messages', {
			openai: {
				errorCode: 'context_length_exceeded',
				errorType: 'invalid_request_error',
				requestId: 'req_2',
			},
		})

		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(error)

		// THEN it keeps the meaning the client gave it and still fails fast
		expect(reasonOf(surfaced)?._tag).toBe('InvalidRequestError')
		expect(
			surfaced instanceof AiError.AiError ? surfaced.isRetryable : undefined,
		).toBe(false)
	})

	it('should leave an invalid request carrying no provider metadata alone', async () => {
		// GIVEN a 400 whose body named no error code at all
		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(invalidRequest('HTTP 400'))

		// THEN nothing is assumed about it — it stays an invalid request
		expect(reasonOf(surfaced)?._tag).toBe('InvalidRequestError')
	})

	it('should leave a failure that is not an invalid request alone', async () => {
		// GIVEN a rate limit, which the client already reports as retryable
		// WHEN the failure passes through the combinator
		const surfaced = await reclassified(
			providerFailure(new AiError.RateLimitError({})),
		)

		// THEN it passes through untouched
		expect(reasonOf(surfaced)?._tag).toBe('RateLimitError')
	})
})
