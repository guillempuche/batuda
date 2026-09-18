import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Resolve the parent thread for a freshly-parsed inbound message.
//
// Algorithm (JWZ-simplified):
//  1. If `inReplyTo` matches a known message in this org → reuse its
//     `external_thread_id`.
//  2. Else walk `references` newest-to-oldest looking for a known
//     ancestor in this org → reuse.
//  3. Else look forward instead of back: if exactly one conversation
//     already holds a message that names this one as an ancestor, join
//     it, and move its key onto this message — the one it starts with.
//     More than one such conversation and it joins none.
//  4. Else this is a thread root → its `external_thread_id` is its
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
				SELECT etl.external_thread_id AS "externalThreadId"
				FROM email_messages em
				JOIN email_thread_links etl
				  ON etl.organization_id = em.organization_id
				 AND etl.external_thread_id = em.thread_key
				WHERE em.organization_id = ${args.organizationId}
				  AND em.message_id = ${args.inReplyTo}
				-- Each message says which conversation it is in, so this is one
				-- answer rather than a chain to weigh up — and it stays the right
				-- answer after a conversation is re-rooted below, which moves its
				-- messages' keys but leaves what they name as ancestors alone.
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
				SELECT etl.external_thread_id AS "externalThreadId"
				FROM email_messages em
				JOIN email_thread_links etl
				  ON etl.organization_id = em.organization_id
				 AND etl.external_thread_id = em.thread_key
				WHERE em.organization_id = ${args.organizationId}
				  AND em.message_id = ${ref}
				LIMIT 1
			`
			const hit = rows[0]?.externalThreadId
			if (hit) return hit
		}

		// Nothing this message names is on file. Before it starts a
		// conversation of its own, look the other way down the chain: a message
		// we already hold may name THIS one as an ancestor.
		//
		// That is the ordinary case, not a rare one. Mail is read inbox first
		// and sent folder second (`inbox-session.ts`, FOLDER_ROLES), so a reply
		// to something sent from the account's own mail client is taken in
		// before the message it answers. Without this the reply starts a
		// conversation, the message it answers starts a second one, and the
		// contact is left with two halves of one exchange for good.
		const descendants = yield* sql<{ id: string; externalThreadId: string }>`
			SELECT DISTINCT etl.id, etl.external_thread_id AS "externalThreadId"
			FROM email_messages em
			JOIN email_thread_links etl
			  ON etl.organization_id = em.organization_id
			 AND etl.external_thread_id = em.thread_key
			WHERE em.organization_id = ${args.organizationId}
			  AND (
			    em."references" @> ARRAY[${args.messageId}]::text[]
			    -- A sender that trims the chain away sends only this one.
			    OR em.in_reply_to = ${args.messageId}
			  )
			-- Two is all this needs to know: one conversation to join, or more
			-- than one and it joins none of them.
			LIMIT 2
		`

		// Exactly one, or none. Several means several people replied to a
		// message we do not hold, and their replies are already filed apart —
		// joining one of them would put this message, and every later reply to
		// it, under whichever contact happened to answer first. That is one
		// company's mail under another company's name, which is worse than the
		// duplicate this is trying to avoid.
		const only = descendants.length === 1 ? descendants[0] : undefined
		if (!only) return args.messageId

		// The conversation is keyed on the id of the message it starts with, and
		// that is this one — the reply only held the key because it arrived
		// first. Moving it over is what keeps the stored chain honest: a message
		// is found in its conversation by that key appearing in its list, so
		// leaving the reply as the key would mean writing the reply into the
		// list of the message it answers, and the two rows would name each other
		// as ancestors.
		//
		// Nothing outside points at this key: a conversation is addressed by its
		// row id everywhere a person or a tool names one, and every message
		// already on it names the arriving one, which is how it was found.
		const rerooted = yield* sql<{ id: string }>`
			UPDATE email_thread_links
			SET external_thread_id = ${args.messageId}
			WHERE id = ${only.id}
			  AND organization_id = ${args.organizationId}
			  -- Another conversation already answering to this key means two
			  -- replicas took the same message in at once. Leave it alone and
			  -- join under the old key rather than fail the whole batch on the
			  -- uniqueness rule.
			  AND NOT EXISTS (
			    SELECT 1 FROM email_thread_links other
			    WHERE other.organization_id = ${args.organizationId}
			      AND other.external_thread_id = ${args.messageId}
			  )
			RETURNING id
		`

		if (rerooted.length === 1) {
			// Each message says which conversation it is in, and the answer just
			// changed. Left behind, those messages would point at a key no
			// conversation answers to any more, and the thread would read as
			// empty.
			yield* sql`
				UPDATE email_messages
				SET thread_key = ${args.messageId}
				WHERE organization_id = ${args.organizationId}
				  AND thread_key = ${only.externalThreadId}
			`
			return args.messageId
		}

		return only.externalThreadId
	})
