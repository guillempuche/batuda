import { Cause, Config, Effect, Layer, Schedule, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CredentialCrypto } from './credential-crypto.js'
import {
	type DecryptedCreds,
	type MailSecurity,
	MailTransport,
} from './mail-transport.js'

interface ActiveInboxRow {
	readonly id: string
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: MailSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: MailSecurity
	readonly username: string
	readonly passwordCiphertext: Uint8Array
	readonly passwordNonce: Uint8Array
	readonly passwordTag: Uint8Array
}

type GrantState = 'connected' | 'auth_failed' | 'connect_failed'

const stateForFailure = (tag: string): Exclude<GrantState, 'connected'> =>
	tag === 'GrantAuthFailed' ? 'auth_failed' : 'connect_failed'

export class InboxHealthProbe extends ServiceMap.Service<InboxHealthProbe>()(
	'InboxHealthProbe',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const transport = yield* MailTransport
			const crypto = yield* CredentialCrypto
			const intervalSec = yield* Config.int(
				'EMAIL_HEALTH_PROBE_INTERVAL_SEC',
			).pipe(Config.withDefault(900))

			const probeOne = (inbox: ActiveInboxRow) =>
				Effect.gen(function* () {
					const password = crypto.decryptPassword({
						inboxId: inbox.id,
						ciphertext: inbox.passwordCiphertext,
						nonce: inbox.passwordNonce,
						tag: inbox.passwordTag,
					})
					const creds: DecryptedCreds = {
						inboxId: inbox.id,
						imapHost: inbox.imapHost,
						imapPort: inbox.imapPort,
						imapSecurity: inbox.imapSecurity,
						smtpHost: inbox.smtpHost,
						smtpPort: inbox.smtpPort,
						smtpSecurity: inbox.smtpSecurity,
						username: inbox.username,
						password,
					}

					const result = yield* Effect.exit(transport.probe(creds))
					if (result._tag === 'Success') {
						yield* sql`
							UPDATE inboxes
							SET grant_status = 'connected',
							    grant_last_error = NULL,
							    grant_last_seen_at = now()
							WHERE id = ${inbox.id}
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
						UPDATE inboxes
						SET grant_status = ${stateForFailure(tag)},
						    grant_last_error = ${detail},
						    grant_last_seen_at = now()
						WHERE id = ${inbox.id}
					`
				})

			const tick = sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_service`
					const rows = yield* sql<ActiveInboxRow>`
						SELECT
							id,
							imap_host          AS "imapHost",
							imap_port          AS "imapPort",
							imap_security      AS "imapSecurity",
							smtp_host          AS "smtpHost",
							smtp_port          AS "smtpPort",
							smtp_security      AS "smtpSecurity",
							username,
							password_ciphertext AS "passwordCiphertext",
							password_nonce      AS "passwordNonce",
							password_tag        AS "passwordTag"
						FROM inboxes
						WHERE active = true
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
	// drive `tick` directly without paying for a daemon.
	static readonly daemonLayer = Layer.effectDiscard(
		Effect.gen(function* () {
			const probe = yield* InboxHealthProbe
			yield* Effect.logInfo(`inbox health probe: every ${probe.intervalSec}s`)
			yield* probe.tick.pipe(
				Effect.catchCause(cause =>
					Effect.logError('inbox health probe tick failed', cause),
				),
				Effect.repeat(Schedule.spaced(`${probe.intervalSec} seconds`)),
				Effect.forkScoped,
			)
		}),
	)
}
