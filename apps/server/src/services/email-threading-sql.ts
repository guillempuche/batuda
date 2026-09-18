import type { SqlClient, Statement } from 'effect/unstable/sql'

/**
 * Which messages are in a conversation, and which of them is the latest.
 *
 * Both questions are asked in several places — the list, a reply, the check
 * that runs before a send — and they have to give the same answer. A reply
 * that answers a different message from the one the list called the latest is
 * a reply to the wrong person.
 *
 * Mail the reader may not see never reaches any of this: the database leaves
 * those rows out on its own (the private-mailbox rules in migration 0073), so
 * a private message inside a shared conversation is neither counted nor
 * answered.
 *
 * The fragments below name their tables `m` (messages) and `tl` (the
 * conversation), which is how every query here spells them.
 */

/**
 * Every message in the conversation, read from the key each message carries
 * rather than by searching its chain of ancestors — which is what lets an
 * index answer instead of reading the whole mailbox.
 */
export const inThread = (sql: SqlClient.SqlClient): Statement.Fragment =>
	sql`m.organization_id = tl.organization_id AND m.thread_key = tl.external_thread_id`

/** The same, for a conversation named by its key rather than by a joined row. */
export const inThreadKey = (
	sql: SqlClient.SqlClient,
	organizationId: string,
	threadKey: string,
): Statement.Fragment =>
	sql`m.organization_id = ${organizationId} AND m.thread_key = ${threadKey}`

/**
 * A message worth answering: not one somebody deleted from their mailbox, and
 * not a delivery failure notice.
 *
 * A deleted message is kept so the conversation still reads in full, but
 * answering it would quote something the other side no longer has. A notice is
 * mail from a mail server rather than from the person, and counting it as the
 * latest message makes a conversation look like it is waiting for our answer.
 */
export const answerable = (sql: SqlClient.SqlClient): Statement.Fragment =>
	sql`m.deleted_at IS NULL AND m.is_delivery_notice = false`

/**
 * The order that puts the conversation's latest message first.
 *
 * The time comes from the message's own date, which counts in whole seconds and
 * so can be equal on two messages; the order then settles on when we stored it,
 * and last on the message's own id, or which message a reply answers could
 * change between two otherwise identical sends.
 */
export const latestFirst = (sql: SqlClient.SqlClient): Statement.Fragment =>
	sql`ORDER BY m.received_at DESC NULLS LAST, m.status_updated_at DESC, m.message_id DESC`

/**
 * Whether the mailbox a conversation began in is one this reader may see.
 *
 * It matters because the conversation row carries two things taken from that
 * first message — the mailbox and the subject — and a conversation can begin in
 * somebody's private mailbox and still be readable, when a later message
 * arrived in a shared one. Showing either then says who keeps a private
 * mailbox and what they were written to about.
 *
 * Expects the conversation as `tl` and its mailbox joined as `i`.
 */
export const startedWhereTheReaderCanSee = (
	sql: SqlClient.SqlClient,
	userId: string,
): Statement.Fragment =>
	sql`(i.id IS NULL OR i.is_private = false OR i.owner_user_id = ${userId})`
