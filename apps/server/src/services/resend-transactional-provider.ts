import { Config, Effect, Layer, Redacted } from 'effect'

import { EmailSendError } from '@batuda/controllers'

import {
	type InvitationParams,
	type MagicLinkParams,
	TransactionalEmailProvider,
} from './transactional-email-provider.js'

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

const buildMagicLinkBody = (
	params: MagicLinkParams,
	from: string,
): ResendBody => ({
	from,
	to: [params.email],
	subject: 'Sign in to Batuda',
	text: `Click the link below to sign in:\n\n${params.url}\n\nThis link will expire shortly.`,
	html: `<p>Click the link below to sign in:</p><p><a href="${params.url}">${params.url}</a></p><p>This link will expire shortly.</p>`,
})

// Plain-text body comes first so spam filters that score the text/html
// pair can read both halves cleanly. The accept link is presented in
// both — invitees on plaintext clients still get a working URL.
const buildInvitationBody = (
	params: InvitationParams,
	from: string,
): ResendBody => {
	const expiry = params.expiresAt.toISOString()
	return {
		from,
		to: [params.email],
		subject: `${params.inviterName} invited you to ${params.organizationName} on Batuda`,
		text: [
			`${params.inviterName} invited you to join ${params.organizationName} on Batuda.`,
			'',
			'Click the link below to accept. The link signs you in automatically — no password needed:',
			'',
			params.inviteUrl,
			'',
			`This invitation expires on ${expiry}.`,
		].join('\n'),
		html: [
			`<p>${params.inviterName} invited you to join <strong>${params.organizationName}</strong> on Batuda.</p>`,
			'<p>Click the link below to accept. The link signs you in automatically — no password needed.</p>',
			`<p><a href="${params.inviteUrl}">${params.inviteUrl}</a></p>`,
			`<p style="color:#666">This invitation expires on ${expiry}.</p>`,
		].join(''),
	}
}

// Sends via the Resend REST API. Raw `fetch` keeps this layer dependency-free
// (no SDK transitives) — magic-link delivery is one POST, one JSON body.
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
			post(buildMagicLinkBody(params, from), params.email)

		const sendInvitation = (params: InvitationParams) =>
			post(buildInvitationBody(params, from), params.email)

		return { sendMagicLink, sendInvitation } as const
	}),
)
