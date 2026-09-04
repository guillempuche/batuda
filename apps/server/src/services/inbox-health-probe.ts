import { Cause, Config, Context, Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import type {
	GrantAuthFailed,
	GrantConnectFailed,
	GrantFailureReason,
} from '@batuda/controllers'
import { boundedCause } from '@batuda/observability'

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
	readonly organizationId: string
}

type GrantState = 'connected' | 'auth_failed' | 'connect_failed'

const stateForFailure = (
	tag: GrantAuthFailed['_tag'] | GrantConnectFailed['_tag'],
): Exclude<GrantState, 'connected'> =>
	tag === 'GrantAuthFailed' ? 'auth_failed' : 'connect_failed'

export class InboxHealthProbe extends Context.Service<InboxHealthProbe>()(
	'InboxHealthProbe',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const transport = yield* MailTransport
			const crypto = yield* CredentialCrypto
			const intervalSec = yield* Config.int('EMAIL_HEALTH_PROBE_INTERVAL_SEC')

			// A transaction per piece of database work, so no connection is held
			// open while a mail server takes its time. The role is set inside each
			// one because it is released with the transaction that set it.
			const inServiceTransaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* sql`SET LOCAL ROLE app_service`
						return yield* work
					}),
				)

			const activeInboxes = inServiceTransaction(sql<ActiveInboxRow>`
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
					password_tag        AS "passwordTag",
					organization_id     AS "organizationId"
				FROM inboxes
				WHERE active = true
			`)

			// A defect leaves nothing in the cause to read, so it is reported as a
			// connection that did not go through rather than guessed at.
			const failureFacts = (
				cause: Cause.Cause<GrantAuthFailed | GrantConnectFailed>,
			): {
				readonly state: Exclude<GrantState, 'connected'>
				readonly detail: string | null
				readonly reason: GrantFailureReason
			} => {
				const found = Cause.findErrorOption(cause)
				if (found._tag === 'None') {
					return { state: 'connect_failed', detail: null, reason: 'unknown' }
				}
				const error = found.value
				return {
					state: stateForFailure(error._tag),
					detail: error.detail,
					reason: error.reason,
				}
			}

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
					const { state, detail, reason } =
						result._tag === 'Success'
							? ({ state: 'connected', detail: null, reason: null } as const)
							: failureFacts(result.cause)

					yield* inServiceTransaction(sql`
						UPDATE inboxes
						SET grant_status = ${state},
						    grant_last_error = ${detail},
						    grant_last_seen_at = now()
						WHERE id = ${inbox.id}
					`)

					// Nobody is waiting on this check, so it gets a line of its own.
					// Only the sort of failure goes down: never the mailbox address,
					// and never the words the mail server wrote about somebody's
					// account. The host names the provider without naming anybody.
					const facts = {
						event: 'inbox.probed',
						inboxId: inbox.id,
						'org.id': inbox.organizationId,
						'imap.host': inbox.imapHost,
						'imap.port': inbox.imapPort,
						'inbox.probe.outcome': state,
						...(reason !== null && { 'inbox.probe.reason': reason }),
					}
					// A check that passed is only the poller saying it is still
					// polling; one that did not is for the mailbox owner to fix.
					yield* state === 'connected'
						? Effect.logDebug('inbox.probed').pipe(Effect.annotateLogs(facts))
						: Effect.logWarning('inbox.probed').pipe(Effect.annotateLogs(facts))
				}).pipe(
					// One mailbox whose answer cannot be written down must not cost the
					// others their turn. A lost permission or a key that fails to
					// decrypt is a fault in the poller rather than in the mailbox, so
					// it goes down as an error. Shutting down skips this entirely: a
					// fiber stopped from outside unwinds without running it.
					Effect.catchCause(cause =>
						Effect.logError('inbox.probe_unrecorded').pipe(
							Effect.annotateLogs({
								event: 'inbox.probe_unrecorded',
								inboxId: inbox.id,
								cause: boundedCause(cause),
							}),
						),
					),
				)

			const tick = Effect.gen(function* () {
				const rows = yield* activeInboxes
				yield* Effect.forEach(rows, probeOne, { concurrency: 4 })
			})

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
