import { createHmac, timingSafeEqual } from 'node:crypto'

import { Config, Effect, Option, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'

import {
	CalendarService,
	decodeCalcomWebhookEnvelope,
} from '../services/calendar'

// Case-insensitive hex compare in constant time. Cal.com's docs don't
// promise a casing; `x-cal-signature-256` is the lowercase header name
// (per RFC 7230 HTTP headers are case-insensitive and Node lowercases
// them on parse) but the hex payload itself could arrive upper/lower.
const hexEquals = (a: string, b: string) => {
	const lowerA = a.toLowerCase()
	const lowerB = b.toLowerCase()
	if (lowerA.length !== lowerB.length) return false
	const bufA = Buffer.from(lowerA, 'utf8')
	const bufB = Buffer.from(lowerB, 'utf8')
	return timingSafeEqual(bufA, bufB)
}

export const CalcomWebhookLive = HttpApiBuilder.group(
	BatudaApi,
	'calcomWebhook',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* CalendarService
			// Optional at boot so the server still starts when cal.com is not
			// configured yet; individual webhook requests fail with 503 until
			// the secret lands. This matches the rest of the stack's
			// "explicit env vars — no silent bypass" policy: refuse to verify
			// rather than accept anything.
			const secretOpt = yield* Config.option(
				Config.redacted('CALENDAR_WEBHOOK_SECRET'),
			)

			return handlers.handleRaw(
				'inbound',
				Effect.fnUntraced(function* ({ request }) {
					if (Option.isNone(secretOpt)) {
						yield* Effect.logWarning(
							'calcom webhook received but CALENDAR_WEBHOOK_SECRET is unset',
						)
						return HttpServerResponse.jsonUnsafe(
							{ error: 'webhook_secret_not_configured' },
							{ status: 503 },
						)
					}
					const secret = Redacted.value(secretOpt.value)

					const rawBody = yield* Effect.orDie(request.text)
					const headers = request.headers
					const signature = headers['x-cal-signature-256']
					// Split "missing" from "empty" on purpose: a caller that
					// forgot the header made a shape error (→400), one that
					// sent it with no value is signing wrong (→401). Using a
					// single `!signature` check collapses both into 400 and
					// hides auth failures as shape bugs.
					if (signature === undefined) {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'missing_signature_header' },
							{ status: 400 },
						)
					}
					if (signature.length === 0) {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'empty_signature' },
							{ status: 401 },
						)
					}

					const expected = createHmac('sha256', secret)
						.update(rawBody)
						.digest('hex')
					if (!hexEquals(signature, expected)) {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'invalid_signature' },
							{ status: 401 },
						)
					}

					let parsed: unknown
					try {
						parsed = JSON.parse(rawBody)
					} catch {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'invalid_json' },
							{ status: 400 },
						)
					}

					// Shape-validate with the same Schema the service reads so a
					// rogue payload (e.g., cal.com ships a new field type we
					// don't expect) fails at the boundary rather than crashing
					// inside `handleCalcomWebhook`. Unknown optional fields in
					// payload decode lenient by default — we only reject on
					// required fields or wrong scalar types.
					const decoded = yield* decodeCalcomWebhookEnvelope(parsed).pipe(
						Effect.map(e => ({ _tag: 'ok' as const, envelope: e })),
						Effect.catch(err =>
							Effect.succeed({
								_tag: 'error' as const,
								message: String(err),
							}),
						),
					)
					if (decoded._tag === 'error') {
						yield* Effect.logWarning(
							'calcom webhook failed schema decode',
						).pipe(
							Effect.annotateLogs({
								event: 'calcom.webhook_invalid_envelope',
								reason: decoded.message,
							}),
						)
						return HttpServerResponse.jsonUnsafe(
							{ error: 'invalid_envelope', detail: decoded.message },
							{ status: 400 },
						)
					}
					const envelope = decoded.envelope

					if (!envelope.payload.iCalUID) {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'missing_ical_uid' },
							{ status: 400 },
						)
					}

					yield* svc.handleCalcomWebhook(envelope).pipe(Effect.orDie)
					return HttpServerResponse.jsonUnsafe({ ok: true })
				}),
			)
		}),
)
