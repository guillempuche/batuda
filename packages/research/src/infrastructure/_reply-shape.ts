/**
 * Accept the chat-completion replies OpenAI-compatible vendors actually send.
 *
 * `@effect/ai-openai-compat` describes a reply more strictly than the vendors
 * behave: `created` and every choice's `index` are required integers, a usage
 * block must carry all three token counters, and `service_tier` is typed as
 * "absent or a string" — never null, which the custom endpoint serving Qwen
 * sends. A reply that is fine in practice is then rejected before any findings
 * are produced, and the run pays a retry against the next configured slot.
 *
 * The fix lives on the HTTP boundary Batuda already supplies to the client, not
 * in the dependency: `tolerateVendorReplyShape` wraps the `HttpClient` so the
 * body is normalized before the library reads it.
 *
 * Only values the library would reject are rewritten, and only in ways that stay
 * true to what the vendor said: an unusable `created` becomes the moment the
 * reply arrived, an unusable choice `index` becomes that choice's own place in
 * the array, and a usage block short one counter has it solved from the other
 * two. A usage block too incomplete to solve is dropped rather than zero-filled
 * — "reported no tokens" is a state callers already handle and bill as zero,
 * whereas an invented counter would be recorded as a measurement. Any repair is
 * logged with the field names it touched, since no configured endpoint has been
 * seen to need one and the first that does should not be silent.
 *
 * Scope: only the research LLM client is wrapped, and only JSON chat-completion
 * responses are touched. Streaming (Server-Sent Events) responses are passed
 * through untouched — buffering their body as text to normalize it would
 * collapse the stream, and research only ever calls the non-streaming
 * generateText / generateObject paths.
 */

import { DateTime, Effect } from 'effect'
import {
	HttpClient,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'

const CONTENT_TYPE_HEADER = 'content-type'
const CONTENT_LENGTH_HEADER = 'content-length'
const EVENT_STREAM_CONTENT_TYPE = 'text/event-stream'
const MILLIS_PER_SECOND = 1000

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

// The library types every timestamp and token counter as a plain integer, so
// anything else — absent, null, a string, a fraction — is what makes decode
// throw. Testing for exactly that keeps the repairs to values the vendor could
// not have sent successfully; whatever already decodes is left alone.
const isDecodableNumber = (value: unknown): value is number =>
	Number.isInteger(value)

const readCounter = (
	usage: Record<string, unknown>,
	name: string,
): number | undefined => {
	const value = usage[name]
	return isDecodableNumber(value) ? value : undefined
}

const repairServiceTier = (
	reply: Record<string, unknown>,
): string | undefined => {
	if (reply['service_tier'] !== null) return undefined
	// Dropping the field, rather than coercing it, is what makes the body satisfy
	// the "absent or a string" shape the library expects.
	delete reply['service_tier']
	return 'service_tier'
}

const repairCreated = (reply: Record<string, unknown>): string | undefined => {
	if (isDecodableNumber(reply['created'])) return undefined
	// The library turns this into the reply's metadata timestamp. For a reply
	// that carried none, the moment it arrived is the closest true answer
	// available — and it is only ever off by the time the call was in flight.
	reply['created'] = Math.floor(
		DateTime.toEpochMillis(DateTime.nowUnsafe()) / MILLIS_PER_SECOND,
	)
	return 'created'
}

const repairChoiceIndexes = (
	choices: ReadonlyArray<unknown>,
): string | undefined => {
	let repaired = false
	choices.forEach((choice, position) => {
		if (!isRecord(choice) || isDecodableNumber(choice['index'])) return
		// The library reads the first choice by its place in the array and never
		// by this number, so a choice's own position is the value it would have
		// been numbered with.
		choice['index'] = position
		repaired = true
	})
	return repaired ? 'index' : undefined
}

type TokenCounters = {
	readonly prompt_tokens: number
	readonly completion_tokens: number
	readonly total_tokens: number
}

// The three counters are one equation — the total is the other two added
// together — so a single absent counter is recoverable from the pair that
// arrived. Two absent leaves nothing to solve from. A subtraction that would go
// negative means this vendor's total is not simply the sum, so it is not solved
// either: a wrong count is worse than an admitted absence.
const solveCounters = (
	prompt: number | undefined,
	completion: number | undefined,
	total: number | undefined,
): TokenCounters | undefined => {
	if (prompt !== undefined && completion !== undefined) {
		return {
			prompt_tokens: prompt,
			completion_tokens: completion,
			total_tokens: total ?? prompt + completion,
		}
	}
	if (total === undefined) return undefined
	if (prompt !== undefined && total >= prompt) {
		return {
			prompt_tokens: prompt,
			completion_tokens: total - prompt,
			total_tokens: total,
		}
	}
	if (completion !== undefined && total >= completion) {
		return {
			prompt_tokens: total - completion,
			completion_tokens: completion,
			total_tokens: total,
		}
	}
	return undefined
}

// Reported apart from a solved block: this is the case that costs the run its
// token counts, so it is worth telling from one that was fully recovered.
const dropUsage = (reply: Record<string, unknown>): string => {
	delete reply['usage']
	return 'usage_dropped'
}

const repairUsage = (reply: Record<string, unknown>): string | undefined => {
	const usage = reply['usage']
	// An absent or null usage block already decodes — it is how the library
	// represents a vendor that reported no tokens.
	if (usage === undefined || usage === null) return undefined
	if (!isRecord(usage)) return dropUsage(reply)

	const prompt = readCounter(usage, 'prompt_tokens')
	const completion = readCounter(usage, 'completion_tokens')
	const total = readCounter(usage, 'total_tokens')
	if (prompt !== undefined && completion !== undefined && total !== undefined) {
		return undefined
	}

	const solved = solveCounters(prompt, completion, total)
	if (solved === undefined) return dropUsage(reply)
	Object.assign(usage, solved)
	return 'usage'
}

export type NormalizedReply = {
	readonly body: string
	/** Which fields had to be repaired, for the log line the caller emits. */
	readonly repaired: ReadonlyArray<string>
}

/**
 * Normalize a chat-completion body so the library's response schema accepts it.
 * Returns the re-serialized JSON alongside what was repaired, or `undefined`
 * when there was nothing to do — the body already decodes, or is not a chat
 * completion at all — so the caller can reuse the original response unchanged.
 */
export const normalizeVendorReply = (
	body: string,
): NormalizedReply | undefined => {
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		return undefined
	}
	if (!isRecord(parsed)) return undefined
	const choices = parsed['choices']
	// Only a chat completion carries these fields. An error body, or any other
	// payload the same client fetches, is handed on exactly as it arrived.
	if (!Array.isArray(choices)) return undefined

	// Every repair runs before the verdict is read — stopping at the first one
	// that reported a change would leave the rest of the body untouched.
	const repaired = [
		repairServiceTier(parsed),
		repairCreated(parsed),
		repairChoiceIndexes(choices),
		repairUsage(parsed),
	].filter((field): field is string => field !== undefined)
	if (repaired.length === 0) return undefined
	return { body: JSON.stringify(parsed), repaired }
}

/**
 * Wrap an `HttpClient` so chat-completion responses are normalized before
 * `@effect/ai-openai-compat` decodes them. The transform callback receives the
 * response effect and the originating request; the request is needed to rebuild
 * the response after reading its body.
 */
export const tolerateVendorReplyShape = (
	client: HttpClient.HttpClient,
): HttpClient.HttpClient =>
	HttpClient.transform(client, (responseEffect, request) =>
		Effect.flatMap(responseEffect, response => {
			const contentType = response.headers[CONTENT_TYPE_HEADER] ?? ''
			if (contentType.includes(EVENT_STREAM_CONTENT_TYPE)) {
				return Effect.succeed(response)
			}
			return Effect.flatMap(response.text, body => {
				const normalized = normalizeVendorReply(body)
				if (normalized === undefined) return Effect.succeed(response)
				const headers: Record<string, string> = {}
				for (const [key, value] of Object.entries(response.headers)) {
					// The body was rewritten; a stale content-length would misreport its
					// size to anything that trusts the header.
					if (key.toLowerCase() !== CONTENT_LENGTH_HEADER) {
						headers[key] = value
					}
				}
				const repaired = HttpClientResponseNs.fromWeb(
					request,
					new Response(normalized.body, {
						status: response.status,
						headers,
					}),
				)
				// Say which fields a vendor left out. Without this a repair is silent,
				// and no configured endpoint has yet been seen to need one — so the
				// first that does should be visible rather than inferred. Field names
				// only; the reply itself carries research content.
				return Effect.as(
					Effect.logInfo('llm.reply_repaired').pipe(
						Effect.annotateLogs({
							event: 'llm.reply_repaired',
							fields: normalized.repaired.join(','),
						}),
					),
					repaired,
				)
			})
		}),
	)
