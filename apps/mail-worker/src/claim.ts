import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// `pg_try_advisory_lock(int)` is session-scoped — when the worker's pg
// session drops, the lock releases automatically. So a crashed worker
// replica frees its inboxes for another replica without manual
// intervention. We hash the inbox id (a UUID string) via `hashtext`
// inside the query so the worker only ever passes the raw inbox id.

export interface ClaimedInbox {
	readonly id: string
	readonly organizationId: string
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: 'tls' | 'starttls' | 'plain'
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: 'tls' | 'starttls' | 'plain'
	readonly username: string
	readonly passwordCiphertext: Uint8Array
	readonly passwordNonce: Uint8Array
	readonly passwordTag: Uint8Array
	readonly folderState: Record<string, unknown>
}

// Try to claim every connected inbox. Inboxes already held by another
// replica's session return locked=false and are skipped this tick.
//
// The worker scans on a timer plus on `LISTEN inbox_changed` wake-ups
// fired from the server's createInbox / updateInbox / deleteInbox
// notifications, so newly-connected inboxes pick up an owner within a
// second.
export const claimAvailableInboxes = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const candidates = yield* sql<{
		id: string
		organizationId: string
		imapHost: string
		imapPort: number
		imapSecurity: 'tls' | 'starttls' | 'plain'
		smtpHost: string
		smtpPort: number
		smtpSecurity: 'tls' | 'starttls' | 'plain'
		username: string
		passwordCiphertext: Uint8Array
		passwordNonce: Uint8Array
		passwordTag: Uint8Array
		folderState: Record<string, unknown>
	}>`
		SELECT
			id,
			organization_id    AS "organizationId",
			imap_host          AS "imapHost",
			imap_port          AS "imapPort",
			imap_security      AS "imapSecurity",
			smtp_host          AS "smtpHost",
			smtp_port          AS "smtpPort",
			smtp_security      AS "smtpSecurity",
			username,
			password_ciphertext AS "passwordCiphertext",
			password_nonce     AS "passwordNonce",
			password_tag       AS "passwordTag",
			folder_state       AS "folderState"
		FROM inboxes
		WHERE active = true
		  AND grant_status = 'connected'
	`

	const claimed: ClaimedInbox[] = []
	for (const row of candidates) {
		const lockRows = yield* sql<{ locked: boolean }>`
			SELECT pg_try_advisory_lock(hashtext('inbox:' || ${row.id})) AS locked
		`
		if (lockRows[0]?.locked === true) {
			claimed.push(row)
		}
	}
	return claimed
})
