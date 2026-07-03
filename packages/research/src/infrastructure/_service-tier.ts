/**
 * Tolerate a `null` `service_tier` in OpenAI-compatible chat-completion
 * responses.
 *
 * The custom endpoint serving Qwen answers with `"service_tier": null` — a
 * field it does not populate. `@effect/ai-openai-compat` decodes the raw body
 * with a schema that types that field as "absent or a string" (never null), so
 * decode throws before any findings are produced and every research call fails.
 *
 * The fix lives on the HTTP boundary Batuda already supplies to the client, not
 * in the dependency: `tolerateNullServiceTier` wraps the `HttpClient` so a
 * `null` `service_tier` is dropped from the JSON body before the library reads
 * it. Dropping the field (rather than coercing it) makes the body satisfy the
 * "absent or a string" shape the library expects.
 *
 * Scope: only the research LLM client is wrapped, and only JSON responses are
 * touched. Streaming (Server-Sent Events) responses are passed through
 * untouched — buffering their body as text to sanitize it would collapse the
 * stream, and research only ever calls the non-streaming generateText /
 * generateObject paths.
 */

import { Effect } from 'effect'
import {
	HttpClient,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'

const CONTENT_TYPE_HEADER = 'content-type'
const CONTENT_LENGTH_HEADER = 'content-length'
const EVENT_STREAM_CONTENT_TYPE = 'text/event-stream'

/**
 * Drop `service_tier` from a chat-completion body when the provider sent it as
 * `null`. Returns the re-serialized JSON when the body changed, or `undefined`
 * when there is nothing to strip — the field is absent, already a string, or
 * the body is not a JSON object — so the caller can reuse the original response
 * unchanged.
 */
export const stripNullServiceTier = (body: string): string | undefined => {
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		return undefined
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return undefined
	}
	const record = parsed as Record<string, unknown>
	if (record['service_tier'] !== null) return undefined
	delete record['service_tier']
	return JSON.stringify(record)
}

/**
 * Wrap an `HttpClient` so JSON responses carrying a `null` `service_tier` are
 * sanitized before `@effect/ai-openai-compat` decodes them. The transform
 * callback receives the response effect and the originating request; the
 * request is needed to rebuild the response after reading its body.
 */
export const tolerateNullServiceTier = (
	client: HttpClient.HttpClient,
): HttpClient.HttpClient =>
	HttpClient.transform(client, (responseEffect, request) =>
		Effect.flatMap(responseEffect, response => {
			const contentType = response.headers[CONTENT_TYPE_HEADER] ?? ''
			if (contentType.includes(EVENT_STREAM_CONTENT_TYPE)) {
				return Effect.succeed(response)
			}
			return Effect.map(response.text, body => {
				const sanitized = stripNullServiceTier(body)
				if (sanitized === undefined) return response
				const headers: Record<string, string> = {}
				for (const [key, value] of Object.entries(response.headers)) {
					// The body shrank by one field; a stale content-length would
					// misreport its size to anything that trusts the header.
					if (key.toLowerCase() !== CONTENT_LENGTH_HEADER) {
						headers[key] = value
					}
				}
				return HttpClientResponseNs.fromWeb(
					request,
					new Response(sanitized, { status: response.status, headers }),
				)
			})
		}),
	)
