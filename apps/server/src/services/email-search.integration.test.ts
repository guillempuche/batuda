// Live-DB integration test for the email FTS rewrite. Verifies that the
// generated tsvector + GIN index on email_messages let listThreads
// match against subject + preview + body per message, and that the
// participants subquery catches sender/recipient hits.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on
// $DATABASE_URL, and `pnpm cli db migrate` so 0004_email_fts has run.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EmailService } from './email.js'
import { makeOrgRuntime, scopedAsOrg } from './email-harness.js'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const ORG_ID = 'email-search-test-org'
const ACME_DOMAIN = 'acme-search.test'

let pool: pg.Pool
let inboxId: string
let bodyOnlyThreadId: string
let subjectOnlyThreadId: string
let recipientOnlyThreadId: string
let accentedThreadId: string

// The search the app actually runs, not a copy of it. This file used to hold
// its own transcription of that query, which meant it kept passing while the
// real one changed underneath — the test could not fail for the thing it was
// written to protect. Everything below goes through the service instead, inside
// the same organisation scope a request runs in.
const asOrg = {
	orgId: ORG_ID,
	orgName: 'Search Test',
	orgSlug: 'search-test',
	userId: 'search-user',
} as const

const runtime = makeOrgRuntime(asOrg)

const searchThreads = (q: string): Promise<string[]> =>
	runtime.runPromise(
		scopedAsOrg(
			asOrg,
			Effect.gen(function* () {
				const emails = yield* EmailService
				const page = yield* emails.listThreads({ query: q })
				return page.items.map(t => t.id)
			}),
		),
	)

const insertThreadWithMessage = async (args: {
	externalThreadId: string
	subject: string | null
	textPreview: string | null
	textBody: string | null
	recipient?: string | undefined
}): Promise<string> => {
	const link = await pool.query<{ id: string }>(
		`INSERT INTO email_thread_links (organization_id, external_thread_id, inbox_id, subject)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[ORG_ID, args.externalThreadId, inboxId, args.subject],
	)
	const linkRow = link.rows[0]
	if (!linkRow) throw new Error('failed to insert thread link')

	const msg = await pool.query<{ id: string }>(
		`INSERT INTO email_messages
		 (organization_id, inbox_id, message_id, direction, folder, raw_rfc822_ref,
		  subject, text_preview, text_body, status, imap_uid, imap_uidvalidity)
		 VALUES ($1, $2, $3, 'inbound', 'INBOX', 'sentinel',
		         $4, $5, $6, 'normal', $7, 100)
		 RETURNING id`,
		[
			ORG_ID,
			inboxId,
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
			`INSERT INTO message_participants (email_message_id, email_address, role)
			 VALUES ($1, $2, 'to')`,
			[msgRow.id, args.recipient],
		)
	}

	return linkRow.id
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })

	const inboxResult = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, imap_host, imap_port, imap_security,
		  smtp_host, smtp_port, smtp_security,
		  username, password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, $2, $3, 
		         'imap.example.com', 993, 'tls',
		         'smtp.example.com', 465, 'tls',
		         $3, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG_ID, `test-user-${randomUUID()}`, `inbox@${ACME_DOMAIN}`],
	)
	const inboxRow = inboxResult.rows[0]
	if (!inboxRow) throw new Error('failed to insert test inbox')
	inboxId = inboxRow.id

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
		`DELETE FROM message_participants WHERE email_message_id IN (SELECT id FROM email_messages WHERE organization_id = $1)`,
		[ORG_ID],
	)
	await pool.query(`DELETE FROM email_messages WHERE organization_id = $1`, [
		ORG_ID,
	])
	await pool.query(
		`DELETE FROM email_thread_links WHERE organization_id = $1`,
		[ORG_ID],
	)
	await pool.query(`DELETE FROM inboxes WHERE organization_id = $1`, [ORG_ID])
	await pool.end()
	await runtime.dispose()
})

describe('the scope these searches run in', () => {
	describe('when the harness enters an organisation', () => {
		it('should put the role and the organisation on the connection the query uses', async () => {
			// GIVEN the harness, which runs an effect the way a request runs
			// WHEN it asks the database who it is and which organisation it is in
			const identity = await runtime.runPromise(
				scopedAsOrg(
					asOrg,
					Effect.gen(function* () {
						const sql = yield* SqlClient.SqlClient
						const rows = yield* sql<{
							who: string
							org: string
						}>`SELECT current_user AS who, current_setting('app.current_org_id', true) AS org`
						return rows[0]
					}).pipe(Effect.orDie),
				),
			)

			// THEN both are set, on the same connection the searches below run on
			// AND this is what makes row-level security real here rather than
			// decorative: built over a second client, the scope would be set on a
			// connection nothing queries, and a search that had lost its
			// organisation filter would still look correct
			expect(identity?.who).toBe('app_user')
			expect(identity?.org).toBe(ORG_ID)
		})
	})
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
