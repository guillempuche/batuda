// Live-DB integration test for the matcher → persist auto-link wiring.
// Verifies that `persistInboundMessage` populates `company_id` and
// `contact_id` on both `email_messages` and `email_thread_links` based
// on the inbound sender address.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on
// $DATABASE_URL, and `pnpm cli db reset && pnpm cli db migrate` so the
// schema is current.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { PgClient } from '@effect/sql-pg'
import { Config, Effect, Redacted } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ParticipantMatcher } from '@batuda/email/participant-matcher'

import { type ParsedInbound, persistInboundMessage } from './persist.js'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

const camelToSnake = (s: string) =>
	s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)

const PgLive = PgClient.layerConfig({
	url: Config.succeed(Redacted.make(DATABASE_URL)),
	transformResultNames: Config.succeed(snakeToCamel),
	transformQueryNames: Config.succeed(camelToSnake),
})

// Run an Effect that needs SqlClient + ParticipantMatcher.
const runIngest = <A, E>(eff: Effect.Effect<A, E, never>): Promise<A> =>
	Effect.runPromise(eff)

// Stable per-suite identifiers so re-running without `db reset` doesn't
// trip uniques. The org id is a string PK; company/contact rows seed
// off it.
const ORG_ID = `test-org-${randomUUID()}`
const ACME_DOMAIN = `acme-${randomUUID()}.example`

let pool: pg.Pool
let inboxId: string
let acmeCompanyId: string
let aliceContactId: string

const insertCompany = async (slug: string, email: string): Promise<string> => {
	const result = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, email) VALUES ($1, $2, $3, $4) RETURNING id`,
		[ORG_ID, slug, slug, email],
	)
	const row = result.rows[0]
	if (!row) throw new Error(`failed to insert company ${slug}`)
	return row.id
}

const insertContact = async (
	companyId: string,
	name: string,
	email: string,
): Promise<string> => {
	const result = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`,
		[ORG_ID, companyId, name],
	)
	const row = result.rows[0]
	if (!row) throw new Error(`failed to insert contact ${email}`)
	// The address lives on the email channel now — that's what inbound
	// matching joins against.
	await pool.query(
		`INSERT INTO contact_channels (organization_id, contact_id, kind, value, is_primary) VALUES ($1, $2, 'email', $3, true)`,
		[ORG_ID, row.id, email],
	)
	return row.id
}

const buildParsed = (overrides: Partial<ParsedInbound>): ParsedInbound => ({
	messageId: `<msg-${randomUUID()}@example>`,
	inReplyTo: null,
	references: [],
	subject: 'test',
	receivedAt: new Date(),
	textBody: null,
	htmlBody: null,
	textPreview: null,
	fromAddress: null,
	toAddresses: [],
	ccAddresses: [],
	bccAddresses: [],
	...overrides,
})

// Per-test imap_uid so the (inbox_id, uidvalidity, uid) dedupe index
// doesn't swallow inserts. uidvalidity stays constant for the suite.
let nextUid = 1
const persist = (parsed: ParsedInbound) =>
	persistInboundMessage({
		organizationId: ORG_ID,
		inboxId,
		folder: 'INBOX',
		imapUid: nextUid++,
		imapUidvalidity: 100,
		rawRfc822Ref: 'sentinel',
		parsed,
		attachments: [],
	}).pipe(Effect.provide(ParticipantMatcher.layer), Effect.provide(PgLive))

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })

	// One inbox row keyed off ORG_ID. Most columns are unused by persist;
	// they exist purely to satisfy NOT NULL constraints on inboxes.
	const inboxResult = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, purpose,
		  imap_host, imap_port, imap_security,
		  smtp_host, smtp_port, smtp_security,
		  username, password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, $2, $3, 'human',
		         'imap.example.com', 993, 'tls',
		         'smtp.example.com', 465, 'tls',
		         $3, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG_ID, `test-user-${randomUUID()}`, `inbox@${ACME_DOMAIN}`],
	)
	const inboxRow = inboxResult.rows[0]
	if (!inboxRow) throw new Error('failed to insert test inbox')
	inboxId = inboxRow.id

	acmeCompanyId = await insertCompany('acme', `info@${ACME_DOMAIN}`)
	aliceContactId = await insertContact(
		acmeCompanyId,
		'Alice',
		`alice@${ACME_DOMAIN}`,
	)
}, 30_000)

afterAll(async () => {
	// Order matters: child rows before parents (no CASCADE on all FKs).
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
	await pool.query(`DELETE FROM contacts WHERE organization_id = $1`, [ORG_ID])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG_ID])
	await pool.query(`DELETE FROM inboxes WHERE organization_id = $1`, [ORG_ID])
	await pool.end()
})

const fetchMessage = async (messageId: string) => {
	const rows = await pool.query<{
		company_id: string | null
		contact_id: string | null
	}>(
		`SELECT company_id, contact_id FROM email_messages WHERE message_id = $1`,
		[messageId],
	)
	return rows.rows[0]
}

const fetchThreadLink = async (externalThreadId: string) => {
	const rows = await pool.query<{
		company_id: string | null
		contact_id: string | null
	}>(
		`SELECT company_id, contact_id FROM email_thread_links WHERE external_thread_id = $1`,
		[externalThreadId],
	)
	return rows.rows[0]
}

describe('persistInboundMessage — CRM auto-link', () => {
	describe('when the sender matches an existing contact', () => {
		it('should populate company_id and contact_id on email_messages', async () => {
			// GIVEN an inbound email from alice@acme (a seeded contact)
			const messageId = `<contact-msg-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `alice@${ACME_DOMAIN}`,
			})

			// WHEN we persist it through the real ingest path
			await runIngest(persist(parsed))

			// THEN the email_messages row carries both IDs
			const row = await fetchMessage(messageId)
			expect(row?.company_id).toBe(acmeCompanyId)
			// AND the contact_id matches the seeded contact
			expect(row?.contact_id).toBe(aliceContactId)
			// [apps/mail-worker/src/persist.ts — MatchedContact branch in companyId / contactId resolution]
		})

		it('should populate company_id and contact_id on the new thread link', async () => {
			// GIVEN the same inbound email opens a brand-new thread
			const messageId = `<thread-msg-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `alice@${ACME_DOMAIN}`,
			})

			// WHEN persisted
			await runIngest(persist(parsed))

			// THEN the thread link row carries the linked IDs
			const link = await fetchThreadLink(messageId)
			expect(link?.company_id).toBe(acmeCompanyId)
			expect(link?.contact_id).toBe(aliceContactId)
			// [apps/mail-worker/src/persist.ts — INSERT INTO email_thread_links … company_id, contact_id]
		})
	})

	describe('when the sender matches only the company by domain', () => {
		it('should populate company_id only; contact_id stays NULL', async () => {
			// GIVEN an inbound email from unknown@acme (no contact, domain matches Acme)
			const messageId = `<co-only-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `unknown@${ACME_DOMAIN}`,
			})

			// WHEN persisted
			await runIngest(persist(parsed))

			// THEN company_id is set but contact_id is NULL
			const row = await fetchMessage(messageId)
			expect(row?.company_id).toBe(acmeCompanyId)
			expect(row?.contact_id).toBeNull()
			// [apps/mail-worker/src/persist.ts — MatchedCompanyOnly branch]
		})
	})

	describe('when the sender matches no contact and no company', () => {
		it('should leave both NULL', async () => {
			// GIVEN an inbound email from a completely unknown sender
			const messageId = `<no-match-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `stranger@nowhere.example`,
			})

			// WHEN persisted
			await runIngest(persist(parsed))

			// THEN both IDs are NULL
			const row = await fetchMessage(messageId)
			expect(row?.company_id).toBeNull()
			expect(row?.contact_id).toBeNull()
			// [apps/mail-worker/src/persist.ts — NoMatch fallthrough]
		})
	})

	describe('when the sender matches multiple contacts (ambiguous)', () => {
		it('should leave both NULL — no arbitrary winner picked', async () => {
			// GIVEN two contacts share the same address (dup data state).
			// Use a dedicated address ("bob") so alice stays unambiguous for
			// later tests that depend on her being a single MatchedContact.
			const bobEmail = `bob@${ACME_DOMAIN}`
			await insertContact(acmeCompanyId, 'Bob A', bobEmail)
			const dupCompany = await insertCompany(
				`dup-${randomUUID()}`,
				`info@dup.example`,
			)
			await insertContact(dupCompany, 'Bob B', bobEmail)

			// WHEN we persist an inbound email from that address
			const messageId = `<ambiguous-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: bobEmail,
			})
			await runIngest(persist(parsed))

			// THEN we don't pick a winner; both stay NULL
			const row = await fetchMessage(messageId)
			expect(row?.company_id).toBeNull()
			expect(row?.contact_id).toBeNull()
			// [packages/email/src/participant-matcher.ts — Ambiguous branch]
		})
	})

	describe('when a second message arrives on an existing thread', () => {
		it('should not overwrite the thread link company_id', async () => {
			// GIVEN a thread already exists, linked to Acme via the first inbound message
			const rootMessageId = `<root-${randomUUID()}@example>`
			const first = buildParsed({
				messageId: rootMessageId,
				fromAddress: `alice@${ACME_DOMAIN}`,
			})
			await runIngest(persist(first))

			// WHEN a reply arrives from a stranger on the same thread
			const reply = buildParsed({
				messageId: `<reply-${randomUUID()}@example>`,
				fromAddress: `stranger@nowhere.example`,
				inReplyTo: rootMessageId,
			})
			await runIngest(persist(reply))

			// THEN the thread link still points at Acme (ON CONFLICT DO UPDATE preserves company_id)
			const link = await fetchThreadLink(rootMessageId)
			expect(link?.company_id).toBe(acmeCompanyId)
			// [apps/mail-worker/src/persist.ts — DO UPDATE clause only touches updated_at]
		})
	})

	describe('when fromAddress is null', () => {
		it('should skip the matcher and leave both NULL', async () => {
			// GIVEN an inbound email with no parseable From address
			const messageId = `<no-from-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: null,
			})

			// WHEN persisted
			await runIngest(persist(parsed))

			// THEN no match is attempted; both IDs are NULL
			const row = await fetchMessage(messageId)
			expect(row?.company_id).toBeNull()
			expect(row?.contact_id).toBeNull()
			// [apps/mail-worker/src/persist.ts — `args.parsed.fromAddress ? matcher.match(…) : new NoMatch(…)` null-guard]
		})
	})
})
