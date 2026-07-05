import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '@batuda/controllers'

import { resolveSystemOrg } from '../middleware/org'
import { CredentialCrypto } from '../services/credential-crypto'
import type { OauthProvider } from '../services/email-oauth'
import { OauthTokenService } from '../services/email-oauth'

// Web-app landing page the browser is bounced back to once the provider
// round-trip finishes. Relative so it resolves against whichever host served
// the redirect; `?error=` variants let the settings screen surface why a
// connection attempt did not complete.
const MAILBOXES_PATH = '/emails/mailboxes'
const errorRedirect = (reason: string) =>
	HttpServerResponse.redirect(`${MAILBOXES_PATH}?error=${reason}`, {
		status: 302,
	})

// Known IMAP + SMTP endpoints per OAuth provider. XOAUTH2 authenticates
// against the same hosts a password connection uses, so the mail-worker still
// needs them on the row; those transport columns are NOT NULL, so an OAuth
// connection must fill them too. Values mirror the Gmail Workspace / Microsoft
// 365 entries in the connect-mailbox provider presets.
const OAUTH_TRANSPORT: Record<
	OauthProvider,
	{
		readonly imapHost: string
		readonly imapPort: number
		readonly imapSecurity: 'tls' | 'starttls' | 'plain'
		readonly smtpHost: string
		readonly smtpPort: number
		readonly smtpSecurity: 'tls' | 'starttls' | 'plain'
	}
> = {
	'gmail-oauth': {
		imapHost: 'imap.gmail.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.gmail.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
	},
	'm365-oauth': {
		imapHost: 'outlook.office365.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.office365.com',
		smtpPort: 587,
		smtpSecurity: 'starttls',
	},
}

export const EmailOauthLive = HttpApiBuilder.group(
	BatudaApi,
	'emailOauthCallback',
	handlers =>
		Effect.gen(function* () {
			const oauth = yield* OauthTokenService
			const crypto = yield* CredentialCrypto
			const sql = yield* SqlClient.SqlClient

			return handlers.handleRaw(
				'oauthCallback',
				Effect.fnUntraced(function* ({ params, query }) {
					// Trust ONLY the org + user the signature vouches for — never a
					// query param or header. A tampered, expired, or forged state is
					// rejected here before any token exchange happens.
					const verified = oauth.verifyState(query.state)
					if (verified === null) {
						return errorRedirect('oauth_state')
					}

					// User cancelled at the provider (or it errored): the redirect
					// carries `?error=…` and no `code` — bounce back to settings.
					if (!query.code) {
						return errorRedirect('oauth_denied')
					}

					// Swap the one-time code for tokens and read the mailbox's own
					// address; any provider-side failure bounces back to settings
					// with an error rather than surfacing a 500.
					const exchanged = yield* oauth
						.exchangeCode({
							provider: params.provider,
							code: query.code,
						})
						.pipe(
							Effect.map(tokens => ({ ok: true as const, tokens })),
							Effect.catchTag('OauthError', () =>
								Effect.succeed({ ok: false as const }),
							),
						)
					if (!exchanged.ok) {
						return errorRedirect('oauth_exchange')
					}
					// The mailbox's own address comes from the exchange's id_token.
					const { tokens } = exchanged
					const address = tokens.email

					// The row id doubles as the HKDF context for the encrypted token
					// blob, so decryption later derives the same per-row subkey.
					const connectionId = randomUUID()
					const encrypted = crypto.encryptConfig({
						connectionId,
						plain: JSON.stringify({
							accessToken: tokens.accessToken,
							refreshToken: tokens.refreshToken,
						}),
					})
					const transport = OAUTH_TRANSPORT[params.provider]

					// Write under the org the signature carries: resolveSystemOrg
					// loads that org, enters its RLS scope (role + org GUC), and
					// fails closed if the org was deleted between consent start and
					// this callback.
					return yield* resolveSystemOrg(sql, verified.orgId, {
						userId: verified.userId,
					})(
						sql`
							INSERT INTO channel_connections ${sql.insert({
								id: connectionId,
								organizationId: verified.orgId,
								externalId: address,
								channel: 'email',
								provider: params.provider,
								purpose: 'human',
								ownerUserId: verified.userId,
								active: true,
								grantStatus: 'connected',
								tokenExpiresAt: tokens.expiresAt,
								imapHost: transport.imapHost,
								imapPort: transport.imapPort,
								imapSecurity: transport.imapSecurity,
								smtpHost: transport.smtpHost,
								smtpPort: transport.smtpPort,
								smtpSecurity: transport.smtpSecurity,
								username: address,
								configCiphertext: encrypted.ciphertext,
								configNonce: encrypted.nonce,
								configTag: encrypted.tag,
							})}
						`,
					).pipe(
						Effect.as(
							HttpServerResponse.redirect(MAILBOXES_PATH, { status: 302 }),
						),
						Effect.catchTag('SystemOrgNotFound', () =>
							Effect.succeed(errorRedirect('oauth_org')),
						),
						// A DB failure after consent (RLS reject, constraint, transient)
						// surfaces as a defect from the SQL layer; catch it so the user
						// lands on the settings page with an error instead of a raw 500
						// after they have already consented.
						Effect.catchDefect(defect =>
							Effect.as(
								Effect.logError('oauth callback insert failed', defect),
								errorRedirect('oauth_insert'),
							),
						),
					)
				}),
			)
		}),
)
