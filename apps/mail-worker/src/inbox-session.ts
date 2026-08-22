import { Effect, Result, Schedule } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { ImapFlow } from 'imapflow'

import { boundedCause } from '@batuda/observability'

import { backfillSinceDate } from './backfill.js'
import type { ClaimedInbox } from './claim.js'
import { CredentialDecryptor } from './decrypt.js'
import { WorkerEnvVars } from './env.js'
import {
	type FolderState,
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

// Folders we monitor per inbox, and what finding a message in one means.
// Gmail's "All Mail" duplicates everything (covered by IMAP \All
// special-use), so we skip it.
//
// Providers disagree on names — Gmail calls its sent folder
// "[Gmail]/Sent Mail" and Outlook "Sent Items", so matching on the name alone
// finds no sent mail on either. We ask the server which folder serves which
// purpose and only fall back to the conventional name.
const FOLDER_ROLES = [
	{ specialUse: '\\Inbox', fallbackPath: 'INBOX', direction: 'inbound' },
	{ specialUse: '\\Sent', fallbackPath: 'Sent', direction: 'outbound' },
] as const

export type TrackedFolder = {
	readonly path: string
	// Settled once from the folder's purpose and handed down, so nothing
	// further along has to read it back out of a folder name.
	readonly direction: 'inbound' | 'outbound'
}

// Pure so it can be tested without a server: the dev catcher (GreenMail) has
// only INBOX, and a provider's real folder list is awkward to stand up.
export const resolveTrackedFolders = (
	boxes: ReadonlyArray<{
		readonly path: string
		readonly specialUse?: string | undefined
	}>,
): ReadonlyArray<TrackedFolder> => {
	const tracked: Array<TrackedFolder> = []
	for (const role of FOLDER_ROLES) {
		const bySpecialUse = boxes.find(box => box.specialUse === role.specialUse)
		const box =
			bySpecialUse ?? boxes.find(entry => entry.path === role.fallbackPath)
		if (box === undefined) continue
		// A server that flags one folder twice would otherwise be synced twice.
		if (tracked.some(entry => entry.path === box.path)) continue
		tracked.push({ path: box.path, direction: role.direction })
	}
	return tracked
}

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

// Open a single mailbox, sync forward from where `progress` says this
// folder was last read (or backfill if we have no resume point /
// uidvalidity drifted) and drain any EXPUNGE events accumulated since
// the last tick. Waiting for the server to report a change happens once
// per pass, in the caller.
const syncOneFolderTick = (args: {
	readonly client: ImapFlow
	readonly inbox: ClaimedInbox
	readonly folder: TrackedFolder
	readonly backfillDays: number
	readonly expungedQueue: Array<{ uid: number; uidValidity: number }>
	readonly progress: Map<string, FolderState>
}) =>
	Effect.gen(function* () {
		const opened = yield* Effect.tryPromise({
			try: () => args.client.mailboxOpen(args.folder.path),
			catch: err =>
				new Error(`mailboxOpen(${args.folder.path}) failed: ${String(err)}`),
		})
		const serverUidvalidity = Number(opened.uidValidity)
		if (!Number.isFinite(serverUidvalidity)) {
			return yield* Effect.fail(
				new Error(
					`bad uidvalidity from ${args.folder.path}: ${opened.uidValidity}`,
				),
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
			}).pipe(Effect.catchCause(cause => Effect.logError(boundedCause(cause))))
		}

		const known = args.progress.get(args.folder.path) ?? null
		const needsBackfill =
			known === null || known.uidvalidity !== serverUidvalidity

		const highest = needsBackfill
			? yield* backfillSinceDate({
					client: args.client,
					organizationId: args.inbox.organizationId,
					inboxId: args.inbox.id,
					folder: args.folder.path,
					direction: args.folder.direction,
					uidvalidity: serverUidvalidity,
					sinceDate: new Date(
						Date.now() - args.backfillDays * 24 * 60 * 60 * 1000,
					),
				})
			: yield* fetchAndIngestNewerThan({
					client: args.client,
					organizationId: args.inbox.organizationId,
					inboxId: args.inbox.id,
					folder: args.folder.path,
					direction: args.folder.direction,
					uidvalidity: serverUidvalidity,
					sinceUid: known.lastUid,
				})

		if (needsBackfill) {
			yield* recordFolderHead({
				inboxId: args.inbox.id,
				folder: args.folder.path,
				uidvalidity: serverUidvalidity,
				lastUid: highest,
			})
		}

		args.progress.set(args.folder.path, {
			uidvalidity: serverUidvalidity,
			lastUid: highest,
			syncedAt: null,
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
		// Only sync folders the server actually exposes, and take each one's
		// purpose from the server rather than its name. The dev catcher
		// (GreenMail) has just INBOX, so a missing sent folder is normal.
		// Recognising none of them means we cannot usefully read this mailbox
		// at all, so we give up and let the retry backoff handle it rather
		// than spinning.
		const available = yield* Effect.tryPromise({
			try: () => client.list(),
			catch: err => new Error(`list mailboxes failed: ${String(err)}`),
		})
		const folders = resolveTrackedFolders(available)
		const [firstFolder] = folders
		if (firstFolder === undefined) {
			return yield* Effect.fail(
				new Error(`no tracked folders available for inbox=${claimed.id}`),
			)
		}

		// How far each folder has been read, carried across passes. Seeded from
		// where the last session left off and kept up to date as we go, so a
		// pass resumes rather than starting the window again.
		const progress = new Map<string, FolderState>()
		for (const folder of folders) {
			const known = readFolderState(claimed.folderState, folder.path)
			if (known !== null) progress.set(folder.path, known)
		}

		// The server can only tell us about the folder we are holding open, so
		// the one we wait on is the one that decides how quickly arriving mail
		// is noticed. We wait on the inbox: a message we sent is already ours
		// and can be picked up on the next pass, but one that arrives is
		// somebody waiting for an answer.
		const folderToWaitOn =
			folders.find(folder => folder.direction === 'inbound') ?? firstFolder

		yield* Effect.gen(function* () {
			while (true) {
				for (const folder of folders) {
					yield* syncOneFolderTick({
						client,
						inbox: claimed,
						folder,
						backfillDays: env.EMAIL_WORKER_BACKFILL_DAYS,
						expungedQueue,
						progress,
					}).pipe(
						Effect.catchCause(cause =>
							Effect.logWarning('Reading a folder failed').pipe(
								Effect.andThen(Effect.logError(boundedCause(cause))),
								Effect.annotateLogs({
									event: 'email.folder_read_failed',
									inboxId: claimed.id,
									folder: folder.path,
								}),
							),
						),
					)
				}
				yield* markHealthy(claimed.id)

				// Hold IMAP IDLE so the server can push `exists`/`expunge` mid-IDLE.
				// imapflow surfaces those as events rather than resolving idle(), so
				// we start it fire-and-forget — the promise settles when the next
				// pass's mailboxOpen breaks IDLE — and park until an event wakes us,
				// or the poll timeout elapses. The poll is the reliable re-sync
				// floor; the event is a low-latency optimization where the server
				// delivers it.
				yield* Effect.tryPromise({
					try: () => client.mailboxOpen(folderToWaitOn.path),
					catch: err =>
						new Error(
							`mailboxOpen(${folderToWaitOn.path}) failed: ${String(err)}`,
						),
				}).pipe(
					Effect.catchCause(cause => Effect.logError(boundedCause(cause))),
				)
				yield* Effect.sync(() => {
					void client.idle().catch(() => {})
				})
				yield* waitForChange
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
			Schedule.min([
				Schedule.exponential('1 second', 2),
				Schedule.spaced('60 seconds'),
			]),
		),
	)
