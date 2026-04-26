import { Effect } from 'effect'
import type { ImapFlow } from 'imapflow'

import { ingestRawMessage } from './ingest.js'

// Initial backfill — runs once per (folder, inbox) when folder_state is
// missing or its uidvalidity no longer matches the server's. Strategy:
// IMAP `SEARCH SINCE <date>` returns UIDs of every message dated within
// the window, then we ingest each. The window is bounded by the env
// var EMAIL_WORKER_BACKFILL_DAYS so a brand-new inbox doesn't yank
// years of mail on first connect.
//
// Returns the highest UID observed (or 0 if the search returned
// nothing) so the caller can persist folder_state.lastUid afterwards.
export const backfillSinceDate = (args: {
	readonly client: ImapFlow
	readonly organizationId: string
	readonly inboxId: string
	readonly folder: string
	readonly uidvalidity: number
	readonly sinceDate: Date
}) =>
	Effect.gen(function* () {
		const uids = yield* Effect.promise(() =>
			args.client.search({ since: args.sinceDate }, { uid: true }),
		)
		if (!uids || uids.length === 0) return 0

		// Ascending so the first persisted message is the oldest — keeps
		// "lastUid" monotonically increasing as we go, so a mid-backfill
		// crash leaves a coherent resume point.
		const sorted = [...uids].sort((a, b) => a - b)
		let highest = 0

		const messages = yield* Effect.promise(async () => {
			const out: Array<{ uid: number; source: Buffer }> = []
			for await (const msg of args.client.fetch(
				sorted,
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
				inboxId: args.inboxId,
				folder: args.folder,
				imapUid: m.uid,
				imapUidvalidity: args.uidvalidity,
				raw: new Uint8Array(m.source),
			}).pipe(
				Effect.catchCause(cause =>
					Effect.logWarning(
						`mail-worker: backfill ingest failed inbox=${args.inboxId} uid=${m.uid}`,
					).pipe(Effect.andThen(Effect.logError(cause))),
				),
			)
			if (m.uid > highest) highest = m.uid
		}

		return highest
	})
