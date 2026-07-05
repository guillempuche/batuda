import { Cause, Config, Effect, Layer, Schedule, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CredentialCrypto } from './credential-crypto.js'
import {
	connectionAuth,
	type DecryptedCreds,
	type MailSecurity,
	MailTransport,
} from './mail-transport.js'

interface ActiveMailboxRow {
	readonly id: string
	readonly provider: 'imap-smtp' | 'gmail-oauth' | 'm365-oauth'
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: MailSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: MailSecurity
	readonly username: string
	readonly configCiphertext: Uint8Array
	readonly configNonce: Uint8Array
	readonly configTag: Uint8Array
}

type GrantState = 'connected' | 'auth_failed' | 'connect_failed'

const stateForFailure = (tag: string): Exclude<GrantState, 'connected'> =>
	tag === 'GrantAuthFailed' ? 'auth_failed' : 'connect_failed'

export class MailboxHealthProbe extends ServiceMap.Service<MailboxHealthProbe>()(
	'MailboxHealthProbe',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const transport = yield* MailTransport
			const crypto = yield* CredentialCrypto
			const intervalSec = yield* Config.int('EMAIL_HEALTH_PROBE_INTERVAL_SEC')

			const probeOne = (mailbox: ActiveMailboxRow) =>
				Effect.gen(function* () {
					const blob = crypto.decryptConfig({
						connectionId: mailbox.id,
						ciphertext: mailbox.configCiphertext,
						nonce: mailbox.configNonce,
						tag: mailbox.configTag,
					})
					const creds: DecryptedCreds = {
						connectionId: mailbox.id,
						imapHost: mailbox.imapHost,
						imapPort: mailbox.imapPort,
						imapSecurity: mailbox.imapSecurity,
						smtpHost: mailbox.smtpHost,
						smtpPort: mailbox.smtpPort,
						smtpSecurity: mailbox.smtpSecurity,
						username: mailbox.username,
						auth: connectionAuth(mailbox.provider, blob),
					}

					const result = yield* Effect.exit(transport.probe(creds))
					if (result._tag === 'Success') {
						yield* sql`
							UPDATE channel_connections
							SET grant_status = 'connected',
							    grant_last_error = NULL,
							    grant_last_seen_at = now()
							WHERE id = ${mailbox.id}
						`
						return
					}
					const failure = Cause.findErrorOption(result.cause)
					const tag =
						failure._tag === 'Some' &&
						typeof failure.value === 'object' &&
						failure.value !== null &&
						'_tag' in failure.value
							? (failure.value as { _tag: string })._tag
							: 'GrantConnectFailed'
					const detail =
						failure._tag === 'Some' &&
						typeof failure.value === 'object' &&
						failure.value !== null &&
						'detail' in failure.value
							? ((failure.value as { detail?: string | null }).detail ?? null)
							: null
					yield* sql`
						UPDATE channel_connections
						SET grant_status = ${stateForFailure(tag)},
						    grant_last_error = ${detail},
						    grant_last_seen_at = now()
						WHERE id = ${mailbox.id}
					`
				})

			const tick = sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_service`
					const rows = yield* sql<ActiveMailboxRow>`
						SELECT
							id,
							provider,
							imap_host          AS "imapHost",
							imap_port          AS "imapPort",
							imap_security      AS "imapSecurity",
							smtp_host          AS "smtpHost",
							smtp_port          AS "smtpPort",
							smtp_security      AS "smtpSecurity",
							username,
							config_ciphertext AS "configCiphertext",
							config_nonce      AS "configNonce",
							config_tag        AS "configTag"
						FROM channel_connections
						WHERE active = true
						  AND provider IN ('imap-smtp', 'gmail-oauth', 'm365-oauth')
					`
					yield* Effect.forEach(rows, probeOne, { concurrency: 4 })
				}),
			)

			return { tick, intervalSec } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)

	// Forks the recurring loop on boot. Separate from `layer` so tests can
	// drive `tick` directly without paying for a daemon. Outputs no service
	// (`effectDiscard`), so it must be listed in `mergeAll` — a `provideMerge`
	// would skip building it and the probe would never start.
	static readonly daemonLayer = Layer.effectDiscard(
		Effect.gen(function* () {
			const probe = yield* MailboxHealthProbe
			yield* Effect.logInfo(`mailbox health probe: every ${probe.intervalSec}s`)
			yield* probe.tick.pipe(
				Effect.catchCause(cause =>
					Effect.logError('mailbox health probe tick failed', cause),
				),
				Effect.repeat(Schedule.spaced(`${probe.intervalSec} seconds`)),
				Effect.forkScoped,
			)
		}),
	)
}
