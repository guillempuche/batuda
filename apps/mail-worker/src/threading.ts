import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Resolve the parent thread for a freshly-parsed inbound message.
//
// Algorithm (JWZ-simplified):
//  1. If `inReplyTo` matches a known message in this org → reuse its
//     `external_thread_id`.
//  2. Else walk `references` newest-to-oldest looking for a known
//     ancestor in this org → reuse.
//  3. Else this is a thread root → its `external_thread_id` is its
//     own `messageId`.
//
// The unique index on `email_thread_links(organization_id,
// external_thread_id)` keeps the upsert race-free across worker
// replicas.
export const resolveThreadId = (args: {
	readonly organizationId: string
	readonly messageId: string
	readonly inReplyTo: string | null
	readonly references: readonly string[]
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		if (args.inReplyTo) {
			const rows = yield* sql<{ externalThreadId: string }>`
				SELECT external_thread_id AS "externalThreadId"
				FROM email_messages em
				JOIN email_thread_links etl
				  ON etl.organization_id = em.organization_id
				 AND (
				   etl.external_thread_id = em.message_id
				   OR etl.external_thread_id = ANY(em."references")
				 )
				WHERE em.organization_id = ${args.organizationId}
				  AND em.message_id = ${args.inReplyTo}
				LIMIT 1
			`
			const hit = rows[0]?.externalThreadId
			if (hit) return hit
		}

		// Newest ancestor first — RFC 5322 puts the immediate parent last,
		// so reverse-iterate to favor the closest known ancestor.
		const refs = [...args.references].reverse()
		for (const ref of refs) {
			const rows = yield* sql<{ externalThreadId: string }>`
				SELECT external_thread_id AS "externalThreadId"
				FROM email_messages em
				JOIN email_thread_links etl
				  ON etl.organization_id = em.organization_id
				 AND (
				   etl.external_thread_id = em.message_id
				   OR etl.external_thread_id = ANY(em."references")
				 )
				WHERE em.organization_id = ${args.organizationId}
				  AND em.message_id = ${ref}
				LIMIT 1
			`
			const hit = rows[0]?.externalThreadId
			if (hit) return hit
		}

		return args.messageId
	})
