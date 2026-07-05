import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// `pg_try_advisory_lock(int)` is session-scoped — when the worker's pg
// session drops, the lock releases automatically. So a crashed worker
// replica frees its connections for another replica without manual
// intervention. We hash the connection id (a UUID string) via `hashtext`
// inside the query so the worker only ever passes the raw connection id.

export interface ClaimedMailbox {
	readonly id: string
	readonly organizationId: string
	readonly provider: 'imap-smtp' | 'gmail-oauth' | 'm365-oauth'
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: 'tls' | 'starttls' | 'plain'
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: 'tls' | 'starttls' | 'plain'
	readonly username: string
	readonly configCiphertext: Uint8Array
	readonly configNonce: Uint8Array
	readonly configTag: Uint8Array
	readonly syncState: Record<string, unknown>
}

// Try to claim every connected IMAP-pollable connection. Connections already
// held by another replica's session return locked=false and are skipped this
// tick. The `provider` guard excludes the `local-inbox` dev catcher — it is a
// filesystem sink with no IMAP server, so opening a client against it would
// loop on connect failures.
//
// The worker scans on a timer plus on `LISTEN connection_changed` wake-ups
// fired from the server's create / update / delete notifications, so a
// newly-connected mailbox picks up an owner within a second.
export const claimAvailableMailboxes = Effect.gen(function* () {
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
		provider: 'imap-smtp' | 'gmail-oauth' | 'm365-oauth'
		configCiphertext: Uint8Array
		configNonce: Uint8Array
		configTag: Uint8Array
		syncState: Record<string, unknown>
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
			provider,
			config_ciphertext  AS "configCiphertext",
			config_nonce       AS "configNonce",
			config_tag         AS "configTag",
			sync_state         AS "syncState"
		FROM channel_connections
		WHERE active = true
		  AND grant_status = 'connected'
		  AND provider IN ('imap-smtp', 'gmail-oauth', 'm365-oauth')
	`

	const claimed: ClaimedMailbox[] = []
	for (const row of candidates) {
		const lockRows = yield* sql<{ locked: boolean }>`
			SELECT pg_try_advisory_lock(hashtext('connection:' || ${row.id})) AS locked
		`
		if (lockRows[0]?.locked === true) {
			claimed.push(row)
		}
	}
	return claimed
})
