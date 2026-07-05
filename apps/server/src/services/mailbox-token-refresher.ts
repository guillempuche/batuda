import { Config, Effect, Layer, Schedule, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CredentialCrypto } from './credential-crypto.js'
import { OauthTokenService } from './email-oauth.js'

// OAuth access tokens expire (~1h) while a mailbox connection stays live for
// days. This daemon refreshes any OAuth connection whose access token is near
// expiry and rewrites the stored encrypted config, so both the server (which
// re-reads the config on every send/probe) and the worker (which re-reads it on
// each reconnect) always authenticate with a valid token. Keeping the refresh
// here — out of the connect path — lets the creds-builders stay pure.
interface OauthConnRow {
	readonly id: string
	readonly provider: 'gmail-oauth' | 'm365-oauth'
	readonly configCiphertext: Uint8Array
	readonly configNonce: Uint8Array
	readonly configTag: Uint8Array
}

export class MailboxTokenRefresher extends ServiceMap.Service<MailboxTokenRefresher>()(
	'MailboxTokenRefresher',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const crypto = yield* CredentialCrypto
			const oauth = yield* OauthTokenService
			const intervalSec = yield* Config.int(
				'EMAIL_OAUTH_REFRESH_INTERVAL_SEC',
			).pipe(Config.withDefault(300))

			const refreshOne = (row: OauthConnRow) =>
				Effect.gen(function* () {
					const blob = crypto.decryptConfig({
						connectionId: row.id,
						ciphertext: row.configCiphertext,
						nonce: row.configNonce,
						tag: row.configTag,
					})
					let refreshToken: string
					try {
						const parsed = JSON.parse(blob) as { refreshToken?: unknown }
						if (
							typeof parsed.refreshToken !== 'string' ||
							parsed.refreshToken.length === 0
						) {
							return
						}
						refreshToken = parsed.refreshToken
					} catch {
						// Corrupt blob — the health probe surfaces it; nothing to refresh.
						return
					}
					// A revoked or expired refresh token leaves the stored config as-is;
					// the health probe flips the connection to auth_failed on its next
					// connect attempt, so here we only log and move on.
					const refreshed = yield* oauth
						.refresh({ provider: row.provider, refreshToken })
						.pipe(
							Effect.catchTag('OauthError', err =>
								Effect.as(
									Effect.logWarning(
										`oauth token refresh failed for connection ${row.id}: ${err.reason}`,
									),
									null,
								),
							),
						)
					if (refreshed === null) return
					// The refresh response carries only a new access token; the durable
					// refresh token is reused, so we re-store it alongside.
					const encrypted = crypto.encryptConfig({
						connectionId: row.id,
						plain: JSON.stringify({
							accessToken: refreshed.accessToken,
							refreshToken,
						}),
					})
					yield* sql`
						UPDATE channel_connections
						SET config_ciphertext = ${encrypted.ciphertext},
						    config_nonce      = ${encrypted.nonce},
						    config_tag        = ${encrypted.tag},
						    token_expires_at  = ${refreshed.expiresAt}
						WHERE id = ${row.id}
					`
				})

			const tick = sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_service`
					// Refresh anything expiring within two intervals so a token is
					// always rewritten at least one full tick before it expires.
					const rows = yield* sql<OauthConnRow>`
						SELECT
							id,
							provider,
							config_ciphertext AS "configCiphertext",
							config_nonce      AS "configNonce",
							config_tag        AS "configTag"
						FROM channel_connections
						WHERE active = true
						  AND provider IN ('gmail-oauth', 'm365-oauth')
						  AND token_expires_at IS NOT NULL
						  AND token_expires_at < now() + ${`${intervalSec * 2} seconds`}::interval
					`
					yield* Effect.forEach(rows, refreshOne, { concurrency: 4 })
				}),
			)

			return { tick, intervalSec } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)

	// Forks the recurring refresh loop on boot, mirroring MailboxHealthProbe:
	// `effectDiscard` outputs no service, so it must sit in `mergeAll` (a
	// `provideMerge` would skip building it and the loop would never start).
	static readonly daemonLayer = Layer.effectDiscard(
		Effect.gen(function* () {
			const refresher = yield* MailboxTokenRefresher
			yield* Effect.logInfo(
				`oauth token refresher: every ${refresher.intervalSec}s`,
			)
			yield* refresher.tick.pipe(
				Effect.catchCause(cause =>
					Effect.logError('oauth token refresher tick failed', cause),
				),
				Effect.repeat(Schedule.spaced(`${refresher.intervalSec} seconds`)),
				Effect.forkScoped,
			)
		}),
	)
}
