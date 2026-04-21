import { createHmac, timingSafeEqual } from 'node:crypto'

import { Config, Effect, Option, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'

import {
	type CalcomWebhookEnvelope,
	CalendarService,
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
					if (!signature) {
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

					let envelope: CalcomWebhookEnvelope
					try {
						envelope = JSON.parse(rawBody) as CalcomWebhookEnvelope
					} catch {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'invalid_json' },
							{ status: 400 },
						)
					}

					if (!envelope?.triggerEvent) {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'missing_trigger_event' },
							{ status: 400 },
						)
					}
					if (!envelope.payload?.iCalUID) {
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
