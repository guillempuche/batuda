/**
 * Read a refused tool call as the model's mistake, not as a broken request.
 *
 * Some providers check a tool call against the tool's own schema before they run
 * it, and answer 400 when the model's arguments do not fit. The client reads a
 * 400 as "the request you built is wrong" — an `InvalidRequestError`, which it
 * never retries. That is right for a bad model name or an unsupported setting,
 * and wrong here: nothing about the request was wrong, the model just named an
 * argument we do not have.
 *
 * When the same mistake is caught on our side instead — the arguments come back
 * and fail to decode — the client raises `ToolParameterValidationError`, which it
 * DOES retry, on the reasoning that the model may write the call correctly next
 * time. Both are the same mistake; only where it was noticed differs, and a
 * provider that checks early should not be the one that costs us the whole run.
 *
 * So a 400 whose provider code says the tool call itself was refused is re-raised
 * as the error the library already has for it, and the retry in `_harden` picks it
 * up with no rule of its own. Only the codes listed below are read this way, and
 * they are read from the code the provider sends rather than from the wording of
 * its message, so a genuinely malformed request still fails fast.
 */

import { Effect } from 'effect'
import { AiError } from 'effect/unstable/ai'

/**
 * Provider error codes meaning "the model wrote a tool call we would not accept".
 *
 * Groq is the only configured provider seen to check tool calls this way; the
 * others hand the arguments back and let the decode fail on our side, which the
 * library already handles. A provider added later that does the same belongs
 * here.
 */
const REJECTED_TOOL_CALL_CODES: ReadonlySet<string> = new Set([
	'tool_use_failed',
])

// Every vendor is reached through the OpenAI-compatible client, so whichever one
// answered, its error code is filed under that client's own key.
const providerErrorCode = (metadata: unknown): string | undefined => {
	if (typeof metadata !== 'object' || metadata === null) return undefined
	const openai = (metadata as { openai?: unknown }).openai
	if (typeof openai !== 'object' || openai === null) return undefined
	const code = (openai as { errorCode?: unknown }).errorCode
	return typeof code === 'string' ? code : undefined
}

const isRejectedToolCall = (err: unknown): err is AiError.AiError =>
	err instanceof AiError.AiError &&
	err.reason._tag === 'InvalidRequestError' &&
	REJECTED_TOOL_CALL_CODES.has(providerErrorCode(err.reason.metadata) ?? '')

// The provider names the tool in its message, and which tool the models keep
// fumbling is worth knowing. Read for the label only — nothing branches on it, so
// a miss costs a vaguer log line. "tool call validation failed" looks the same to
// a pattern as a tool being named, hence the words skipped below.
const TOOL_NAME_IN_MESSAGE = /\btool ([A-Za-z_][A-Za-z0-9_]*)/gi
const WORDING_NOT_A_NAME: ReadonlySet<string> = new Set(['call', 'calls'])
const toolNamed = (description: string): string => {
	for (const match of description.matchAll(TOOL_NAME_IN_MESSAGE)) {
		const name = match[1]
		if (name !== undefined && !WORDING_NOT_A_NAME.has(name.toLowerCase()))
			return name
	}
	return 'unknown'
}

// The status the provider answered with, kept for the log because the error this
// becomes carries no HTTP details of its own.
const httpStatus = (reason: AiError.AiErrorReason): number | undefined =>
	'http' in reason ? reason.http?.response?.status : undefined

/**
 * Re-raise a refused tool call as the retryable error it is, leaving every other
 * failure exactly as the provider client reported it.
 */
export const reclassifyRejectedToolCall =
	(provider: string, tier: string | undefined) =>
	<A, R>(
		eff: Effect.Effect<A, AiError.AiError, R>,
	): Effect.Effect<A, AiError.AiError, R> =>
		eff.pipe(
			Effect.catchIf(isRejectedToolCall, err => {
				const reason = err.reason
				const description =
					'description' in reason && typeof reason.description === 'string'
						? reason.description
						: reason.message
				const toolName = toolNamed(description)
				const status = httpStatus(reason)
				return Effect.logInfo('llm.tool_call_rejected').pipe(
					Effect.annotateLogs({
						event: 'llm.tool_call_rejected',
						provider,
						tool: toolName,
						...(tier !== undefined ? { tier } : {}),
						...(status !== undefined ? { status } : {}),
					}),
					Effect.flatMap(() =>
						Effect.fail(
							AiError.make({
								module: err.module,
								method: err.method,
								reason: new AiError.ToolParameterValidationError({
									toolName,
									// The provider reports what its own check objected to, never
									// the arguments the model sent, so there are none to carry.
									toolParams: null,
									description,
								}),
							}),
						),
					),
				)
			}),
		)
