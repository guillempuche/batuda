import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { ImapFlow } from 'imapflow'

import { boundedCause } from '@batuda/observability'

import { ingestRawMessage } from './ingest.js'

// Per-folder sync state stored under inboxes.folder_state JSONB:
//   { "INBOX": { "uidvalidity": 1234, "lastUid": 9876, "syncedAt": "2026-..." } }
// Read defensively — folder may not exist yet, fields may be wrong type.
//
// `stuckUid` is the message the folder is waiting on, and `attempts` is how
// many passes have tried it. They are how a message that cannot be taken in is
// retried instead of skipped, and eventually given up on out loud instead of
// blocking the folder for good.
export interface FolderState {
	readonly uidvalidity: number
	readonly lastUid: number
	readonly syncedAt: string | null
	readonly stuckUid: number | null
	readonly attempts: number
}

// How many passes a single message may fail before the folder moves on without
// it. Low, because each pass is a fresh connection and a fresh transaction: a
// message that has failed this often is failing on its own contents, not on
// anything a further wait would settle.
const MAX_INGEST_ATTEMPTS = 5

export const readFolderState = (
	state: Record<string, unknown> | null,
	folder: string,
): FolderState | null => {
	if (!state || typeof state !== 'object') return null
	const entry = (state as Record<string, unknown>)[folder]
	if (!entry || typeof entry !== 'object') return null
	const e = entry as Record<string, unknown>
	const uv = typeof e['uidvalidity'] === 'number' ? e['uidvalidity'] : null
	const lu = typeof e['lastUid'] === 'number' ? e['lastUid'] : null
	if (uv === null || lu === null) return null
	const sa = typeof e['syncedAt'] === 'string' ? e['syncedAt'] : null
	// Absent on every folder written before these existed, which reads as a
	// folder that is not waiting on anything.
	const su = typeof e['stuckUid'] === 'number' ? e['stuckUid'] : null
	const at = typeof e['attempts'] === 'number' ? e['attempts'] : 0
	return {
		uidvalidity: uv,
		lastUid: lu,
		syncedAt: sa,
		stuckUid: su,
		attempts: at,
	}
}

const writeFolderState = (
	inboxId: string,
	folder: string,
	state: FolderState,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			UPDATE inboxes
			SET folder_state = jsonb_set(
				COALESCE(folder_state, '{}'::jsonb),
				ARRAY[${folder}],
				${JSON.stringify(state)}::jsonb,
				true
			)
			WHERE id = ${inboxId}
		`
	})

// Soft-delete an EXPUNGEd message — row stays so thread history holds.
// Worker-issued; safe under concurrent EXPUNGE/EXISTS because UID is
// monotonic per uidvalidity epoch.
export const markExpunged = (args: {
	readonly inboxId: string
	readonly imapUidvalidity: number
	readonly imapUid: number
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			UPDATE email_messages
			SET deleted_at = now()
			WHERE inbox_id = ${args.inboxId}
			  AND imap_uidvalidity = ${args.imapUidvalidity}
			  AND imap_uid = ${args.imapUid}
			  AND deleted_at IS NULL
		`
	})

// Fetch every UID strictly greater than `sinceUid` and ingest each.
// Returns how far the folder has been read, so the caller can carry it into the
// next pass. When no new messages exist, `lastUid` comes back unchanged.
//
// The cursor only moves past a message that was actually taken in. A message
// that fails stops the pass where it is, so the next one starts again from it
// rather than leaving it behind — mail that never landed anywhere is not
// something the folder should walk past quietly.
export const fetchAndIngestNewerThan = (args: {
	readonly client: ImapFlow
	readonly organizationId: string
	readonly inboxId: string
	readonly folder: string
	readonly direction: 'inbound' | 'outbound'
	readonly uidvalidity: number
	readonly sinceUid: number
	readonly stuckUid: number | null
	readonly attempts: number
}) =>
	Effect.gen(function* () {
		let highest = args.sinceUid
		let stuckUid = args.stuckUid
		let attempts = args.attempts
		// Range `${sinceUid+1}:*` — imapflow accepts `*` for "highest".
		// `uid: true` means we treat the range as UIDs not seqnums.
		const messages = yield* Effect.promise(async () => {
			const out: Array<{ uid: number; source: Buffer }> = []
			for await (const msg of args.client.fetch(
				`${args.sinceUid + 1}:*`,
				{ source: true, uid: true },
				{ uid: true },
			)) {
				if (msg.source && typeof msg.uid === 'number') {
					out.push({ uid: msg.uid, source: msg.source })
				}
			}
			return out
		})

		for (const m of messages) {
			const stored = yield* ingestRawMessage({
				organizationId: args.organizationId,
				inboxId: args.inboxId,
				folder: args.folder,
				direction: args.direction,
				imapUid: m.uid,
				imapUidvalidity: args.uidvalidity,
				raw: new Uint8Array(m.source),
			}).pipe(
				Effect.as(true),
				Effect.catchCause(cause =>
					Effect.logWarning('Ingesting a message failed').pipe(
						Effect.andThen(Effect.logError(boundedCause(cause))),
						Effect.annotateLogs({
							event: 'email.ingest_failed',
							inboxId: args.inboxId,
							folder: args.folder,
							imapUid: m.uid,
						}),
						Effect.as(false),
					),
				),
			)

			if (stored) {
				if (m.uid > highest) highest = m.uid
				if (stuckUid === m.uid) {
					stuckUid = null
					attempts = 0
				}
				continue
			}

			attempts = stuckUid === m.uid ? attempts + 1 : 1
			stuckUid = m.uid

			// Given up on, and said so at a level somebody is watching. Walking
			// past it loses one message; refusing to would leave every message
			// behind it unread for as long as this one keeps failing, which is
			// the worse of the two.
			if (attempts >= MAX_INGEST_ATTEMPTS) {
				yield* Effect.logError(
					'Giving up on a message that will not load',
				).pipe(
					Effect.annotateLogs({
						event: 'email.ingest_abandoned',
						inboxId: args.inboxId,
						folder: args.folder,
						imapUid: m.uid,
						attempts,
					}),
				)
				if (m.uid > highest) highest = m.uid
				stuckUid = null
				attempts = 0
				continue
			}

			// Everything after this one waits for the next pass, so it is read
			// in order rather than around the gap.
			break
		}

		const progress: FolderState = {
			uidvalidity: args.uidvalidity,
			lastUid: highest,
			syncedAt: new Date().toISOString(),
			stuckUid,
			attempts,
		}
		if (
			highest !== args.sinceUid ||
			stuckUid !== args.stuckUid ||
			attempts !== args.attempts
		) {
			yield* writeFolderState(args.inboxId, args.folder, progress)
		}

		return progress
	})

// Persist the (uidvalidity, lastUid) pair after a backfill so the next
// session resumes from there. Backfill computes lastUid itself because
// it doesn't go through the sinceUid+1 fetch path.
export const recordFolderHead = (args: {
	readonly inboxId: string
	readonly folder: string
	readonly uidvalidity: number
	readonly lastUid: number
}) =>
	writeFolderState(args.inboxId, args.folder, {
		uidvalidity: args.uidvalidity,
		lastUid: args.lastUid,
		syncedAt: new Date().toISOString(),
		stuckUid: null,
		attempts: 0,
	})
