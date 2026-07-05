import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { ImapFlow } from 'imapflow'

import { ingestRawMessage } from './ingest.js'

// Per-folder sync state stored under channel_connections.sync_state JSONB:
//   { "INBOX": { "uidvalidity": 1234, "lastUid": 9876, "syncedAt": "2026-..." } }
// Read defensively — folder may not exist yet, fields may be wrong type.
export interface FolderState {
	readonly uidvalidity: number
	readonly lastUid: number
	readonly syncedAt: string | null
}

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
	return { uidvalidity: uv, lastUid: lu, syncedAt: sa }
}

const writeFolderState = (
	mailboxId: string,
	folder: string,
	state: FolderState,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			UPDATE channel_connections
			SET sync_state = jsonb_set(
				COALESCE(sync_state, '{}'::jsonb),
				ARRAY[${folder}],
				${JSON.stringify(state)}::jsonb,
				true
			)
			WHERE id = ${mailboxId}
		`
	})

// Soft-delete an EXPUNGEd message — row stays so thread history holds.
// Worker-issued; safe under concurrent EXPUNGE/EXISTS because UID is
// monotonic per uidvalidity epoch.
export const markExpunged = (args: {
	readonly mailboxId: string
	readonly imapUidvalidity: number
	readonly imapUid: number
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			UPDATE messages
			SET deleted_at = now()
			WHERE connection_id = ${args.mailboxId}
			  AND imap_uidvalidity = ${args.imapUidvalidity}
			  AND imap_uid = ${args.imapUid}
			  AND deleted_at IS NULL
		`
	})

// Fetch every UID strictly greater than `sinceUid` and ingest each.
// Returns the highest UID actually persisted so the caller can advance
// sync_state.lastUid. When no new messages exist, returns sinceUid
// unchanged.
export const fetchAndIngestNewerThan = (args: {
	readonly client: ImapFlow
	readonly organizationId: string
	readonly mailboxId: string
	readonly folder: string
	readonly uidvalidity: number
	readonly sinceUid: number
}) =>
	Effect.gen(function* () {
		let highest = args.sinceUid
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
			yield* ingestRawMessage({
				organizationId: args.organizationId,
				mailboxId: args.mailboxId,
				folder: args.folder,
				imapUid: m.uid,
				imapUidvalidity: args.uidvalidity,
				raw: new Uint8Array(m.source),
			}).pipe(
				// One bad message must not block the rest of the batch — ingest
				// failures land in logs and sync_state still advances on
				// successes. The dedupe index makes a re-fetch on next sync
				// idempotent if the cause was transient.
				Effect.catchCause(cause =>
					Effect.logWarning(
						`mail-worker: ingest failed mailbox=${args.mailboxId} uid=${m.uid}`,
					).pipe(Effect.andThen(Effect.logError(cause))),
				),
			)
			if (m.uid > highest) highest = m.uid
		}

		if (highest !== args.sinceUid) {
			yield* writeFolderState(args.mailboxId, args.folder, {
				uidvalidity: args.uidvalidity,
				lastUid: highest,
				syncedAt: new Date().toISOString(),
			})
		}

		return highest
	})

// Persist the (uidvalidity, lastUid) pair after a backfill so the next
// session resumes from there. Backfill computes lastUid itself because
// it doesn't go through the sinceUid+1 fetch path.
export const recordFolderHead = (args: {
	readonly mailboxId: string
	readonly folder: string
	readonly uidvalidity: number
	readonly lastUid: number
}) =>
	writeFolderState(args.mailboxId, args.folder, {
		uidvalidity: args.uidvalidity,
		lastUid: args.lastUid,
		syncedAt: new Date().toISOString(),
	})
