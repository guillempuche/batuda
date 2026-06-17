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

// When the email connection drops, the IMAP library reports it as an 'error'
// event from outside our normal flow. With no listener, that crashes the whole
// worker — taking down every mailbox it watches, not just this one. So we
// listen and just record it; the worker's retry loop reconnects on its own.
export const onImapClientError =
	(inboxId: string) =>
	(error: unknown): void => {
		console.warn(
			JSON.stringify({
				level: 'WARN',
				message: 'imap client error (will reconnect)',
				inboxId,
				error: error instanceof Error ? error.message : String(error),
			}),
		)
	}

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
	readonly waitForChange: Effect.Effect<void>
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
			const e = args.expungedQueue.shift()
			if (e === undefined) break
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

		// Hold IMAP IDLE so the server can push `exists`/`expunge` mid-IDLE.
		// imapflow surfaces those as events rather than resolving idle(), so we
		// start it fire-and-forget — the promise settles when the next tick's
		// mailboxOpen breaks IDLE — and park until an event wakes us, or the
		// poll timeout elapses. The poll is the reliable re-sync floor; the
		// event is a low-latency optimization where the server delivers it.
		yield* Effect.sync(() => {
			void args.client.idle().catch(() => {})
		})
		yield* args.waitForChange
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

		client.on('error', onImapClientError(claimed.id))

		// EXPUNGE arrives over IDLE. The listener runs outside any Effect
		// scope so we can't issue SQL from it directly — instead we
		// accumulate events in a plain array that the next tick drains.
		// Bounded growth: even pathological providers won't expunge faster
		// than we can drain on the round-robin (sub-second between ticks).
		const expungedQueue: Array<{ uid: number; uidValidity: number }> = []

		// New mail surfaces as an `exists` event and removals as `expunge`
		// while imapflow auto-IDLEs the selected mailbox. Both wake the folder
		// loop (parked in `waitForChange`) so it re-syncs promptly. The
		// listeners run outside any Effect scope, so they poke a plain callback
		// the parked Effect installs.
		let onChange: (() => void) | null = null
		const signalChange = () => onChange?.()
		client.on('exists', signalChange)
		client.on('expunge', (data: unknown) => {
			const d = data as { uid?: number; uidValidity?: number }
			if (typeof d?.uid === 'number' && typeof d?.uidValidity === 'number') {
				expungedQueue.push({ uid: d.uid, uidValidity: d.uidValidity })
			}
			signalChange()
		})

		// Park until the server reports a change, or the poll interval elapses
		// as a safety net for servers whose IDLE push is unreliable. Reuses
		// EMAIL_WORKER_IDLE_TIMEOUT_SEC as the longest gap between re-syncs.
		const waitForChange = Effect.callback<void>(resume => {
			let settled = false
			const done = () => {
				if (settled) return
				settled = true
				onChange = null
				resume(Effect.void)
			}
			onChange = done
			const timer = setTimeout(done, env.EMAIL_WORKER_IDLE_TIMEOUT_SEC * 1000)
			return Effect.sync(() => {
				clearTimeout(timer)
				if (onChange === done) onChange = null
			})
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

		// Per inbox we sync each tracked folder in a round-robin, parking on
		// server change-events (or a poll timeout) between passes.
		//
		// Only sync folders the server actually exposes. Providers vary —
		// the dev catcher (GreenMail) has just INBOX, Gmail names Sent
		// "[Gmail]/Sent Mail" — so opening a hardcoded "Sent" would error
		// every tick. INBOX is guaranteed by the IMAP spec; bail if even
		// that is missing so the retry backoff handles it, not a hot loop.
		const available = yield* Effect.tryPromise({
			try: () => client.list(),
			catch: err => new Error(`list mailboxes failed: ${String(err)}`),
		})
		const availablePaths = new Set(available.map(box => box.path))
		const folders = TRACKED_FOLDERS.filter(f => availablePaths.has(f))
		if (folders.length === 0) {
			return yield* Effect.fail(
				new Error(`no tracked folders available for inbox=${claimed.id}`),
			)
		}

		yield* Effect.gen(function* () {
			while (true) {
				for (const folder of folders) {
					yield* syncOneFolderTick({
						client,
						inbox: claimed,
						folder,
						backfillDays: env.EMAIL_WORKER_BACKFILL_DAYS,
						expungedQueue,
						waitForChange,
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
