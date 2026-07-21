import { Config, Effect, Layer, Redacted } from 'effect'

import { EmailSendError } from '@batuda/controllers'

import {
	type MagicLinkParams,
	type MemberAddedParams,
	type ResetPasswordParams,
	TransactionalEmailProvider,
} from './transactional-email-provider.js'
import {
	magicLinkEmail,
	memberAddedEmail,
	type RenderedEmail,
	resetPasswordEmail,
	resolveLang,
} from './transactional-email-templates.js'

// Resend's `POST /emails` is the entire transactional surface we need.
// Documented at https://resend.com/docs/api-reference/emails/send-email.
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

interface ResendBody {
	readonly from: string
	readonly to: readonly string[]
	readonly subject: string
	readonly text: string
	readonly html: string
}

const toBody = (
	rendered: RenderedEmail,
	to: string,
	from: string,
): ResendBody => ({
	from,
	to: [to],
	subject: rendered.subject,
	text: rendered.text,
	html: rendered.html,
})

// Sends via the Resend REST API. Raw `fetch` keeps this layer dependency-free
// (no SDK transitives) — every template is one POST, one JSON body.
export const ResendTransactionalProviderLive = Layer.effect(
	TransactionalEmailProvider,
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted('EMAIL_API_KEY_TRANSACTIONAL')
		const from = yield* Config.string('EMAIL_FROM_TRANSACTIONAL')

		const post = (
			body: ResendBody,
			recipient: string,
		): Effect.Effect<void, EmailSendError> =>
			Effect.gen(function* () {
				const response = yield* Effect.tryPromise({
					try: () =>
						fetch(RESEND_ENDPOINT, {
							method: 'POST',
							headers: {
								Authorization: `Bearer ${Redacted.value(apiKey)}`,
								'Content-Type': 'application/json',
							},
							body: JSON.stringify(body),
						}),
					catch: e =>
						new EmailSendError({
							// Network-layer failure (DNS, TLS, connection refused).
							// Surfacing the upstream message would risk leaking
							// the API key if it appeared in a stack trace, so we
							// keep the error narrow.
							message: `resend: request failed: ${e instanceof Error ? e.message : 'unknown error'}`,
							kind: 'unknown',
							recipient,
						}),
				})

				if (!response.ok) {
					const detail = yield* Effect.tryPromise({
						try: () => response.text(),
						catch: () => new Error('unable to read response body'),
					}).pipe(Effect.catch(() => Effect.succeed('')))
					return yield* Effect.fail(
						new EmailSendError({
							message: `resend: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`,
							kind: response.status >= 500 ? 'unknown' : 'invalid_recipient',
							recipient,
						}),
					)
				}
			})

		const sendMagicLink = (params: MagicLinkParams) =>
			post(
				toBody(
					magicLinkEmail[resolveLang(params.locale)](params.url),
					params.email,
					from,
				),
				params.email,
			)

		const sendMemberAdded = (params: MemberAddedParams) =>
			post(
				toBody(
					memberAddedEmail[resolveLang(params.locale)]({
						addedByName: params.addedByName,
						organizationName: params.organizationName,
						signInUrl: params.signInUrl,
					}),
					params.email,
					from,
				),
				params.email,
			)

		const sendResetPassword = (params: ResetPasswordParams) =>
			post(
				toBody(
					resetPasswordEmail[resolveLang(params.locale)](
						params.url,
						params.expiresAt,
					),
					params.email,
					from,
				),
				params.email,
			)

		return { sendMagicLink, sendMemberAdded, sendResetPassword } as const
	}),
)
