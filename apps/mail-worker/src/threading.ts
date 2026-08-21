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
				-- A conversation can hold more than one of these rows when its
				-- first message was taken in after a reply that named it, so pick
				-- deterministically rather than whichever comes back first. A
				-- references chain runs oldest first, so the earliest entry that
				-- has a conversation is the conversation — the message's own id
				-- would name the later split instead, which holds only the tail.
				ORDER BY array_position(em."references", etl.external_thread_id)
				           ASC NULLS LAST,
				         etl.created_at ASC, etl.id ASC
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
				-- A conversation can hold more than one of these rows when its
				-- first message was taken in after a reply that named it, so pick
				-- deterministically rather than whichever comes back first. A
				-- references chain runs oldest first, so the earliest entry that
				-- has a conversation is the conversation — the message's own id
				-- would name the later split instead, which holds only the tail.
				ORDER BY array_position(em."references", etl.external_thread_id)
				           ASC NULLS LAST,
				         etl.created_at ASC, etl.id ASC
				LIMIT 1
			`
			const hit = rows[0]?.externalThreadId
			if (hit) return hit
		}

		// Nothing on file to hang this on, so this message starts a conversation
		// of its own.
		//
		// The oldest id it names looks like the better answer — it would let a
		// reply taken in before the message it answers join that one later,
		// instead of leaving the contact with two. It is not: several people
		// replying to one message we do not hold all name the same id, so they
		// would land in a single conversation, and a conversation belongs to
		// whoever is on the first message to reach it. The second company's
		// mail would then sit under the first company's. Measured both ways —
		// a duplicate conversation costs less than mixing two customers.
		return args.messageId
	})
