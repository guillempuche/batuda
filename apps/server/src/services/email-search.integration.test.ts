// Live-DB integration test for the email FTS rewrite. Verifies that the
// generated tsvector + GIN index on messages let listThreads
// match against subject + preview + body per message, and that the
// participants subquery catches sender/recipient hits.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on
// $DATABASE_URL, and `pnpm cli db migrate` so 0004_email_fts has run.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const ORG_ID = `test-org-${randomUUID()}`
const ACME_DOMAIN = `acme-${randomUUID()}.example`

let pool: pg.Pool
let mailboxId: string
let bodyOnlyThreadId: string
let subjectOnlyThreadId: string
let recipientOnlyThreadId: string
let accentedThreadId: string

// Mirrors the FTS WHERE branch in apps/server/src/services/email.ts:listThreads.
// Returns the matched thread_link ids for `q` scoped to ORG_ID.
const searchThreads = async (q: string): Promise<string[]> => {
	const rows = await pool.query<{ id: string }>(
		`
		SELECT tl.id
		FROM conversations tl
		WHERE tl.organization_id = $1
		  AND (
		    EXISTS (
		      SELECT 1 FROM messages em
		      WHERE em.organization_id = tl.organization_id
		        AND (em.message_id = tl.external_thread_id
		             OR tl.external_thread_id = ANY(em."references"))
		        AND em.search_vector @@ plainto_tsquery('simple', $2)
		    )
		    OR EXISTS (
		      SELECT 1 FROM messages em2
		      JOIN message_participants mp ON mp.message_id = em2.id
		      WHERE em2.organization_id = tl.organization_id
		        AND (em2.message_id = tl.external_thread_id
		             OR tl.external_thread_id = ANY(em2."references"))
		        AND mp.address ILIKE $3
		    )
		  )
		`,
		[ORG_ID, q, `%${q}%`],
	)
	return rows.rows.map(r => r.id)
}

const insertThreadWithMessage = async (args: {
	externalThreadId: string
	subject: string | null
	textPreview: string | null
	textBody: string | null
	recipient?: string | undefined
}): Promise<string> => {
	const link = await pool.query<{ id: string }>(
		`INSERT INTO conversations (organization_id, external_thread_id, connection_id, subject)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[ORG_ID, args.externalThreadId, mailboxId, args.subject],
	)
	const linkRow = link.rows[0]
	if (!linkRow) throw new Error('failed to insert thread link')

	const msg = await pool.query<{ id: string }>(
		`INSERT INTO messages
		 (organization_id, connection_id, message_id, direction, folder, raw_rfc822_ref,
		  subject, text_preview, text_body, status, imap_uid, imap_uidvalidity)
		 VALUES ($1, $2, $3, 'inbound', 'INBOX', 'sentinel',
		         $4, $5, $6, 'normal', $7, 100)
		 RETURNING id`,
		[
			ORG_ID,
			mailboxId,
			args.externalThreadId,
			args.subject,
			args.textPreview,
			args.textBody,
			Math.floor(Math.random() * 1_000_000_000),
		],
	)
	const msgRow = msg.rows[0]
	if (!msgRow) throw new Error('failed to insert email message')

	if (args.recipient) {
		await pool.query(
			`INSERT INTO message_participants (message_id, address, role, channel)
			 VALUES ($1, $2, 'to', 'email')`,
			[msgRow.id, args.recipient],
		)
	}

	return linkRow.id
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })

	const mailboxResult = await pool.query<{ id: string }>(
		`INSERT INTO channel_connections
		 (organization_id, owner_user_id, external_id, purpose,
		  imap_host, imap_port, imap_security,
		  smtp_host, smtp_port, smtp_security,
		  username, config_ciphertext, config_nonce, config_tag)
		 VALUES ($1, $2, $3, 'human',
		         'imap.example.com', 993, 'tls',
		         'smtp.example.com', 465, 'tls',
		         $3, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG_ID, `test-user-${randomUUID()}`, `mailbox@${ACME_DOMAIN}`],
	)
	const mailboxRow = mailboxResult.rows[0]
	if (!mailboxRow) throw new Error('failed to insert test mailbox')
	mailboxId = mailboxRow.id

	bodyOnlyThreadId = await insertThreadWithMessage({
		externalThreadId: `<body-${randomUUID()}@${ACME_DOMAIN}>`,
		subject: 'Hi',
		textPreview: 'opening line',
		textBody: 'please find the invoice attached',
	})

	subjectOnlyThreadId = await insertThreadWithMessage({
		externalThreadId: `<subject-${randomUUID()}@${ACME_DOMAIN}>`,
		subject: 'Project kickoff Monday',
		textPreview: null,
		textBody: 'see calendar',
	})

	recipientOnlyThreadId = await insertThreadWithMessage({
		externalThreadId: `<recipient-${randomUUID()}@${ACME_DOMAIN}>`,
		subject: 'just hello',
		textPreview: null,
		textBody: 'plain body',
		recipient: 'partner@example.com',
	})

	accentedThreadId = await insertThreadWithMessage({
		externalThreadId: `<accent-${randomUUID()}@${ACME_DOMAIN}>`,
		subject: "cançó d'aquesta nit",
		textPreview: null,
		textBody: 'lyrics',
	})
}, 30_000)

afterAll(async () => {
	await pool.query(
		`DELETE FROM message_participants WHERE message_id IN (SELECT id FROM messages WHERE organization_id = $1)`,
		[ORG_ID],
	)
	await pool.query(`DELETE FROM messages WHERE organization_id = $1`, [ORG_ID])
	await pool.query(`DELETE FROM conversations WHERE organization_id = $1`, [
		ORG_ID,
	])
	await pool.query(
		`DELETE FROM channel_connections WHERE organization_id = $1`,
		[ORG_ID],
	)
	await pool.end()
})

describe('email search — full-text', () => {
	describe('when the query matches a word only present in the body', () => {
		it('should return the thread even though the subject does not match', async () => {
			// GIVEN a thread whose only mention of "invoice" is in the body
			// WHEN we search for "invoice"
			const ids = await searchThreads('invoice')

			// THEN the body-only thread is returned
			expect(ids).toContain(bodyOnlyThreadId)
			// [apps/server/src/services/email.ts — em.search_vector @@ plainto_tsquery]
		})
	})

	describe('when the query matches the subject only', () => {
		it('should return the thread via the subject weight', async () => {
			// GIVEN a thread whose subject contains "kickoff" but the body does not
			// WHEN we search for "kickoff"
			const ids = await searchThreads('kickoff')

			// THEN the subject-only thread is returned
			expect(ids).toContain(subjectOnlyThreadId)
			// [apps/server/src/db/migrations/0004_email_fts.ts — setweight(subject, 'A')]
		})
	})

	describe('when the query matches a recipient email address', () => {
		it('should return the thread via the participants subquery', async () => {
			// GIVEN a thread whose recipient is "partner@example.com" and whose
			// body/subject do NOT mention that string
			// WHEN we search for "partner@example"
			const ids = await searchThreads('partner@example')

			// THEN the thread is returned via the EXISTS message_participants branch
			expect(ids).toContain(recipientOnlyThreadId)
			// [apps/server/src/services/email.ts — EXISTS message_participants ILIKE]
		})
	})

	describe('when the query is the exact accented form of a subject', () => {
		it('should match the accented thread', async () => {
			// GIVEN a thread whose subject contains "cançó"
			// WHEN we search for the exact accented form
			const ids = await searchThreads('cançó')

			// THEN the accented thread is returned
			expect(ids).toContain(accentedThreadId)
			// [apps/server/src/db/migrations/0004_email_fts.ts — to_tsvector('simple') keeps accents]
		})
	})

	describe('when the query is the unaccented form of an accented subject', () => {
		it('should not match (accent-folding deferred)', async () => {
			// GIVEN the same thread above; tsvector keeps accents because
			// unaccent() is STABLE, not IMMUTABLE
			// WHEN we search for "canco" (no accent)
			const ids = await searchThreads('canco')

			// THEN the accented thread is NOT returned — folding is a follow-up
			expect(ids).not.toContain(accentedThreadId)
			// [apps/server/src/db/migrations/0004_email_fts.ts — no unaccent wrapper yet]
		})
	})

	describe('when the query matches nothing', () => {
		it('should return zero rows', async () => {
			// GIVEN no thread mentions "zzz-no-match"
			// WHEN we search for it
			const ids = await searchThreads('zzz-no-match')

			// THEN the result is empty
			expect(ids).toHaveLength(0)
		})
	})
})
