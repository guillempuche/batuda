import { Effect, Result, Schedule } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { ImapFlow } from 'imapflow'

import { backfillSinceDate } from './backfill.js'
import type { ClaimedInbox } from './claim.js'
import { CredentialDecryptor } from './decrypt.js'
import { WorkerEnvVars } from './env.js'
import {
	fetchAndIngestNewerThan,
	markExpunged,
	readFolderState,
	recordFolderHead,
} from './folder-sync.js'

// Folders we monitor per inbox. Most providers have INBOX + Sent;
// Gmail's "All Mail" duplicates everything (covered by IMAP \All
// special-use), so we skip it. Outbound rows we APPEND to "Sent" still
// land here on the next sync — `idx_email_messages_msgid` dedupes.
const TRACKED_FOLDERS: readonly string[] = ['INBOX', 'Sent']

// Flip an inbox's grant_status when authentication or connection
// proves broken across retries. Worker writes this; UI surfaces it via
// inboxes.grant_status badge so the user can re-enter credentials.
const markGrantFailure = (
	inboxId: string,
	status: 'auth_failed' | 'connect_failed',
	detail: string,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			UPDATE inboxes
			SET grant_status = ${status},
			    grant_last_error = ${detail.slice(0, 500)},
			    grant_last_seen_at = now()
			WHERE id = ${inboxId}
		`
	})

const markHealthy = (inboxId: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			UPDATE inboxes
			SET grant_last_seen_at = now(),
			    grant_last_error = NULL
			WHERE id = ${inboxId}
			  AND grant_status = 'connected'
		`
	})

// Open a single mailbox, sync from folder_state.lastUid forward (or
// backfill if we have no resume point / uidvalidity drifted), drain
// any EXPUNGE events accumulated since the last tick, then idle until
// the server reports a change. Returns when idle resolves; the caller
// loops.
const syncOneFolderTick = (args: {
	readonly client: ImapFlow
	readonly inbox: ClaimedInbox
	readonly folder: string
	readonly backfillDays: number
	readonly expungedQueue: Array<{ uid: number; uidValidity: number }>
}) =>
	Effect.gen(function* () {
		const opened = yield* Effect.tryPromise({
			try: () => args.client.mailboxOpen(args.folder),
			catch: err =>
				new Error(`mailboxOpen(${args.folder}) failed: ${String(err)}`),
		})
		const serverUidvalidity = Number(opened.uidValidity)
		if (!Number.isFinite(serverUidvalidity)) {
			return yield* Effect.fail(
				new Error(`bad uidvalidity from ${args.folder}: ${opened.uidValidity}`),
			)
		}

		// Drain any EXPUNGE events the listener accumulated. We do this
		// before the new fetch so a delete + re-add (rare) can't race.
		while (args.expungedQueue.length > 0) {
			const e = args.expungedQueue.shift()!
			yield* markExpunged({
				inboxId: args.inbox.id,
				imapUidvalidity: e.uidValidity,
				imapUid: e.uid,
			}).pipe(Effect.catchCause(cause => Effect.logError(cause)))
		}

		const known = readFolderState(args.inbox.folderState, args.folder)
		const needsBackfill =
			known === null || known.uidvalidity !== serverUidvalidity

		if (needsBackfill) {
			const sinceDate = new Date(
				Date.now() - args.backfillDays * 24 * 60 * 60 * 1000,
			)
			const highest = yield* backfillSinceDate({
				client: args.client,
				organizationId: args.inbox.organizationId,
				inboxId: args.inbox.id,
				folder: args.folder,
				uidvalidity: serverUidvalidity,
				sinceDate,
			})
			yield* recordFolderHead({
				inboxId: args.inbox.id,
				folder: args.folder,
				uidvalidity: serverUidvalidity,
				lastUid: highest,
			})
		} else {
			yield* fetchAndIngestNewerThan({
				client: args.client,
				organizationId: args.inbox.organizationId,
				inboxId: args.inbox.id,
				folder: args.folder,
				uidvalidity: serverUidvalidity,
				sinceUid: known.lastUid,
			})
		}

		// IDLE: resolves on EXISTS / EXPUNGE from server, on the
		// constructor-set maxIdleTime, or when client.idle() is called
		// again. Either way the outer loop will re-enter syncOneFolderTick
		// and pick up the delta.
		yield* Effect.tryPromise({
			try: () => args.client.idle(),
			catch: err => new Error(`idle failed on ${args.folder}: ${String(err)}`),
		})
	})

// One inbox = one IMAP connection per tracked folder. We keep things
// simple by processing folders sequentially within a single client:
// imapflow can only have one active mailbox per connection at a time,
// so a "two folders, one client" model means we round-robin. For an
// MVP that's good enough; large mailboxes can later be split onto
// separate clients keyed by folder.
export const runInboxSession = (claimed: ClaimedInbox) =>
	Effect.gen(function* () {
		const env = yield* WorkerEnvVars
		const decryptor = yield* CredentialDecryptor

		const password = decryptor.decrypt({
			inboxId: claimed.id,
			ciphertext: claimed.passwordCiphertext,
			nonce: claimed.passwordNonce,
			tag: claimed.passwordTag,
		})

		const client = new ImapFlow({
			host: claimed.imapHost,
			port: claimed.imapPort,
			secure: claimed.imapSecurity === 'tls',
			auth: { user: claimed.username, pass: password },
			logger: false,
			// RFC 2177 caps IDLE at 30 minutes; we re-issue at ~29 (env-tunable)
			// so the connection breaks idle slightly before the server would.
			maxIdleTime: env.EMAIL_WORKER_IDLE_TIMEOUT_SEC * 1000,
		})

		// EXPUNGE arrives over IDLE. The listener runs outside any Effect
		// scope so we can't issue SQL from it directly — instead we
		// accumulate events in a plain array that the next tick drains.
		// Bounded growth: even pathological providers won't expunge faster
		// than we can drain on the round-robin (sub-second between ticks).
		const expungedQueue: Array<{ uid: number; uidValidity: number }> = []
		client.on('expunge', (data: unknown) => {
			const d = data as { uid?: number; uidValidity?: number }
			if (typeof d?.uid === 'number' && typeof d?.uidValidity === 'number') {
				expungedQueue.push({ uid: d.uid, uidValidity: d.uidValidity })
			}
		})

		const connectResult = yield* Effect.result(
			Effect.tryPromise({
				try: () => client.connect(),
				catch: err => err as unknown,
			}),
		)
		if (Result.isFailure(connectResult)) {
			const err = connectResult.failure as {
				authenticationFailed?: boolean
				message?: string
			}
			const detail = err?.message ?? String(connectResult.failure)
			yield* markGrantFailure(
				claimed.id,
				err?.authenticationFailed === true ? 'auth_failed' : 'connect_failed',
				detail,
			)
			return yield* Effect.fail(new Error(detail))
		}

		yield* markHealthy(claimed.id)

		// Round-robin every tracked folder. The idle inside each tick
		// gives up to ~29 min of low-power waiting per folder before we
		// rotate to the next.
		yield* Effect.gen(function* () {
			while (true) {
				for (const folder of TRACKED_FOLDERS) {
					yield* syncOneFolderTick({
						client,
						inbox: claimed,
						folder,
						backfillDays: env.EMAIL_WORKER_BACKFILL_DAYS,
						expungedQueue,
					}).pipe(
						Effect.catchCause(cause =>
							Effect.logWarning(
								`mail-worker: folder tick failed inbox=${claimed.id} folder=${folder}`,
							).pipe(Effect.andThen(Effect.logError(cause))),
						),
					)
				}
				yield* markHealthy(claimed.id)
			}
		}).pipe(
			Effect.ensuring(
				Effect.promise(() => client.logout().catch(() => undefined)),
			),
		)
	}).pipe(
		// Reconnect with exponential backoff on transient failure, capped
		// at 60s so a flaky provider doesn't burn through retries.
		Effect.retry(
			Schedule.exponential('1 second', 2).pipe(
				Schedule.either(Schedule.spaced('60 seconds')),
			),
		),
	)
