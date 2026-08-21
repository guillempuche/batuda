// Live-DB integration test for the matcher → persist auto-link wiring.
// Verifies that `persistMessage` populates `company_id` and
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

import { type ParsedInbound, persistMessage } from './persist.js'

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
	transformJson: Config.succeed(false),
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
		`INSERT INTO companies (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
		[ORG_ID, slug, slug],
	)
	const row = result.rows[0]
	if (!row) throw new Error(`failed to insert company ${slug}`)
	// The company's own mailbox is one of the addresses it holds, not a column.
	// It matters here because matching an inbound sender to a company reads it.
	await pool.query(
		`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, is_primary)
		 VALUES ($1, 'companies', $2, 'email', $3, true)`,
		[ORG_ID, row.id, email],
	)
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
		`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, is_primary) VALUES ($1, 'contacts', $2, 'email', $3, true)`,
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

// Per-test imap_uid so the (inbox_id, folder, uidvalidity, uid) dedupe index
// doesn't swallow inserts. uidvalidity stays constant for the suite.
let nextUid = 1
const persistIn = (
	parsed: ParsedInbound,
	where: {
		folder: string
		direction: 'inbound' | 'outbound'
		imapUid?: number
	},
) =>
	persistMessage({
		organizationId: ORG_ID,
		inboxId,
		folder: where.folder,
		direction: where.direction,
		imapUid: where.imapUid ?? nextUid++,
		imapUidvalidity: 100,
		rawRfc822Ref: 'sentinel',
		parsed,
		attachments: [],
	}).pipe(Effect.provide(ParticipantMatcher.layer), Effect.provide(PgLive))

const persist = (parsed: ParsedInbound) =>
	persistIn(parsed, { folder: 'INBOX', direction: 'inbound' })

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })

	// One inbox row keyed off ORG_ID. Most columns are unused by persist;
	// they exist purely to satisfy NOT NULL constraints on inboxes.
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
		id: string
		company_id: string | null
		contact_id: string | null
		direction: string
	}>(
		`SELECT id, company_id, contact_id, direction FROM email_messages WHERE message_id = $1`,
		[messageId],
	)
	return rows.rows[0]
}

const fetchThreadLink = async (externalThreadId: string) => {
	const rows = await pool.query<{
		company_id: string | null
		contact_id: string | null
		subject: string | null
	}>(
		`SELECT company_id, contact_id, subject FROM email_thread_links WHERE external_thread_id = $1`,
		[externalThreadId],
	)
	return rows.rows[0]
}

describe('persistMessage — CRM auto-link', () => {
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
			// [DO UPDATE clause leaves company_id alone]
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

// Replies are sent under the conversation's subject, so a conversation that
// never got one sends a message with no subject line at all — which arrives as
// "(no subject)" and scores as spam.
describe('persistMessage — the conversation keeps a subject', () => {
	describe('when the first message on a conversation arrives', () => {
		it('should put its subject on the conversation', async () => {
			// GIVEN an arriving message with a subject
			const rootMessageId = `<subject-root-${randomUUID()}@example>`
			await runIngest(
				persist(
					buildParsed({
						messageId: rootMessageId,
						subject: 'your pallet pools',
					}),
				),
			)

			// THEN the conversation carries it
			const link = await fetchThreadLink(rootMessageId)
			expect(link?.subject).toBe('your pallet pools')
		})
	})

	describe('when a later message arrives on the same conversation', () => {
		it('should not rename the conversation', async () => {
			// GIVEN a conversation started under one subject
			const rootMessageId = `<subject-keep-${randomUUID()}@example>`
			await runIngest(
				persist(
					buildParsed({
						messageId: rootMessageId,
						subject: 'your pallet pools',
					}),
				),
			)

			// WHEN a reply arrives with the subject rewritten
			await runIngest(
				persist(
					buildParsed({
						messageId: `<subject-keep-reply-${randomUUID()}@example>`,
						inReplyTo: rootMessageId,
						subject: 'Re: your pallet pools — revised',
					}),
				),
			)

			// THEN the conversation keeps the subject it started with
			// AND replies keep going out under a stable subject
			const link = await fetchThreadLink(rootMessageId)
			expect(link?.subject).toBe('your pallet pools')
		})
	})

	describe('when the first message had no subject', () => {
		it('should fill one in from the next message that has one', async () => {
			// GIVEN a conversation started by a message with no subject
			const rootMessageId = `<subject-backfill-${randomUUID()}@example>`
			await runIngest(
				persist(buildParsed({ messageId: rootMessageId, subject: null })),
			)
			const before = await fetchThreadLink(rootMessageId)
			expect(before?.subject).toBeNull()

			// WHEN a later message on it does have one
			await runIngest(
				persist(
					buildParsed({
						messageId: `<subject-backfill-reply-${randomUUID()}@example>`,
						inReplyTo: rootMessageId,
						subject: 'your pallet pools',
					}),
				),
			)

			// THEN the conversation picks it up rather than staying blank
			// [COALESCE(NULLIF(subject, ''), EXCLUDED.subject)]
			const after = await fetchThreadLink(rootMessageId)
			expect(after?.subject).toBe('your pallet pools')
		})

		it('should fill one in when the first message had an empty one', async () => {
			// GIVEN a first message whose subject is present but empty, which
			// sends just as badly as none at all
			const rootMessageId = `<subject-empty-${randomUUID()}@example>`
			await runIngest(
				persist(buildParsed({ messageId: rootMessageId, subject: '' })),
			)

			// WHEN a later message on it carries a real one
			await runIngest(
				persist(
					buildParsed({
						messageId: `<subject-empty-reply-${randomUUID()}@example>`,
						inReplyTo: rootMessageId,
						subject: 'your pallet pools',
					}),
				),
			)

			// THEN the empty one is replaced rather than kept
			// [NULLIF(subject, '')]
			const link = await fetchThreadLink(rootMessageId)
			expect(link?.subject).toBe('your pallet pools')
		})
	})

	describe('when the conversation starts with a message we sent', () => {
		it('should put its subject on the conversation too', async () => {
			// GIVEN our own message, read back from the sent folder
			const rootMessageId = `<subject-outbound-${randomUUID()}@example>`
			await runIngest(
				persistIn(
					buildParsed({
						messageId: rootMessageId,
						subject: 'your pallet pools',
					}),
					{ folder: 'Sent', direction: 'outbound' },
				),
			)

			// THEN the conversation carries it, so a later reply has a subject
			// to borrow whichever way the conversation began
			const link = await fetchThreadLink(rootMessageId)
			expect(link?.subject).toBe('your pallet pools')
		})
	})
})

describe('persistMessage — a message can be found in its conversation', () => {
	describe('when a reply names only the message it answers', () => {
		it('should still show up in the conversation it belongs to', async () => {
			// GIVEN a conversation of three: a first message, a reply to it, and
			// a reply to THAT one which names only its immediate parent — the
			// shape a client sends when it writes In-Reply-To and no References,
			// and the shape a client that trims a long chain sends too
			const root = `<find-root-${randomUUID()}@example>`
			const middle = `<find-middle-${randomUUID()}@example>`
			const last = `<find-last-${randomUUID()}@example>`
			await runIngest(persist(buildParsed({ messageId: root, subject: 'q' })))
			await runIngest(
				persist(
					buildParsed({
						messageId: middle,
						inReplyTo: root,
						references: [root],
						subject: 'Re: q',
					}),
				),
			)
			await runIngest(
				persist(
					buildParsed({
						messageId: last,
						inReplyTo: middle,
						references: [middle],
						subject: 'Re: q',
					}),
				),
			)

			// THEN all three are in the conversation
			// AND without the conversation's own id on the last one it would be
			// filed correctly and then never shown, counted, or marked unread —
			// which is how a customer's answer goes missing
			const rows = await pool.query<{ message_id: string }>(
				`SELECT message_id FROM email_messages
				 WHERE organization_id = $1
				   AND (message_id = $2 OR "references" @> ARRAY[$2]::text[])
				 ORDER BY received_at`,
				[ORG_ID, root],
			)
			expect(rows.rows.map(r => r.message_id).sort()).toEqual(
				[root, middle, last].sort(),
			)
		})
	})
})

describe('persistMessage — which way a message went', () => {
	const historyRowsFor = async (messageDbId: string) =>
		(
			await pool.query<{ kind: string; direction: string }>(
				`SELECT kind, direction FROM timeline_activity WHERE entity_id = $1`,
				[messageDbId],
			)
		).rows

	describe('when the message was found in the sent folder', () => {
		it('should record it as one we sent', async () => {
			// GIVEN a message sitting in the sent folder — one we sent, whatever
			// the address it came from happens to match
			const messageId = `<sent-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `alice@${ACME_DOMAIN}`,
			})

			// WHEN it is taken in from that folder
			await runIngest(
				persistIn(parsed, { folder: 'Sent', direction: 'outbound' }),
			)

			// THEN it is stored as outbound, so the thread does not show our own
			// message as something the company said to us
			const row = await fetchMessage(messageId)
			expect(row?.direction).toBe('outbound')
		})

		it('should stay out of the company history', async () => {
			// GIVEN a sent message whose address does match a company
			// [apps/mail-worker/src/persist.ts — the timeline insert is skipped
			// unless the message arrived]
			const messageId = `<sent-history-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `alice@${ACME_DOMAIN}`,
			})

			// WHEN it is taken in from the sent folder
			await runIngest(
				persistIn(parsed, { folder: 'Sent', direction: 'outbound' }),
			)

			// THEN nothing is filed as mail that arrived
			const row = await fetchMessage(messageId)
			expect(await historyRowsFor(row!.id)).toEqual([])
		})
	})

	describe('when the message arrived in the inbox', () => {
		it('should be filed as mail that arrived', async () => {
			// GIVEN a message from a known company landing in the inbox
			const messageId = `<received-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `alice@${ACME_DOMAIN}`,
			})

			// WHEN it is taken in
			await runIngest(persist(parsed))

			// THEN it is inbound, and it shows on the company's history
			const row = await fetchMessage(messageId)
			expect(row?.direction).toBe('inbound')
			expect(await historyRowsFor(row!.id)).toEqual([
				{ kind: 'email_received', direction: 'inbound' },
			])
		})
	})
})

describe('persistMessage — a message we already hold', () => {
	const rowsFor = async (messageId: string) =>
		(
			await pool.query<{
				id: string
				direction: string
				folder: string
				imap_uid: number | null
				text_body: string | null
			}>(
				`SELECT id, direction, folder, imap_uid, text_body FROM email_messages WHERE message_id = $1`,
				[messageId],
			)
		).rows

	describe('when our own sent message comes back from the sent folder', () => {
		it('should fill in where it lives rather than store it again', async () => {
			// GIVEN a message already recorded because we sent it — no folder
			// position yet, because it had not been read back from the server
			const messageId = `<ours-${randomUUID()}@example>`
			await pool.query(
				`INSERT INTO email_messages
				 (organization_id, inbox_id, message_id, direction, folder, raw_rfc822_ref,
				  status, text_body, imap_uid, imap_uidvalidity)
				 VALUES ($1, $2, $3, 'outbound', 'Sent', 'sent-ref', 'normal', $4, NULL, NULL)`,
				[ORG_ID, inboxId, messageId, 'What we actually sent.'],
			)

			// WHEN the sent folder is read and the same message is found there
			await runIngest(
				persistIn(
					buildParsed({ messageId, textBody: 'What we actually sent.' }),
					{
						folder: 'Sent',
						direction: 'outbound',
						imapUid: 4242,
					},
				),
			)

			// THEN it is still the one message, still ours, now knowing where it
			// sits on the server — rather than being turned away for reusing a
			// Message-ID, which would undo everything read alongside it
			const rows = await rowsFor(messageId)
			expect(rows).toHaveLength(1)
			expect(rows[0]?.direction).toBe('outbound')
			expect(rows[0]?.imap_uid).toBe(4242)
			expect(rows[0]?.text_body).toBe('What we actually sent.')
		})
	})

	describe('when the same folder position is read twice', () => {
		it('should keep one copy', async () => {
			// GIVEN a message taken in from the inbox
			const messageId = `<twice-${randomUUID()}@example>`
			const parsed = buildParsed({ messageId })
			await runIngest(
				persistIn(parsed, {
					folder: 'INBOX',
					direction: 'inbound',
					imapUid: 5150,
				}),
			)

			// WHEN the same position is read again, as it is after a restart
			await runIngest(
				persistIn(parsed, {
					folder: 'INBOX',
					direction: 'inbound',
					imapUid: 5150,
				}),
			)

			// THEN it is stored once
			expect(await rowsFor(messageId)).toHaveLength(1)
		})
	})

	describe('when two folders number their messages the same', () => {
		it('should keep both, because they are different messages', async () => {
			// GIVEN two genuinely different messages that happen to sit at the same
			// position in two folders — which a server is free to do
			const inboxMessage = `<inbox-${randomUUID()}@example>`
			const sentMessage = `<sent-${randomUUID()}@example>`

			// WHEN both are taken in
			await runIngest(
				persistIn(buildParsed({ messageId: inboxMessage }), {
					folder: 'INBOX',
					direction: 'inbound',
					imapUid: 9001,
				}),
			)
			await runIngest(
				persistIn(buildParsed({ messageId: sentMessage }), {
					folder: 'Sent',
					direction: 'outbound',
					imapUid: 9001,
				}),
			)

			// THEN neither is mistaken for the other and lost
			expect(await rowsFor(inboxMessage)).toHaveLength(1)
			expect(await rowsFor(sentMessage)).toHaveLength(1)
		})
	})
})

describe('persistMessage — whose conversation it is', () => {
	describe('when we wrote to a company', () => {
		it('should file it under whom we wrote to, not under ourselves', async () => {
			// GIVEN a message we sent to a known contact, found in the sent folder.
			// Its sender is our own mailbox, which belongs to no company.
			const messageId = `<to-acme-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `inbox@${ACME_DOMAIN}`,
				toAddresses: [`alice@${ACME_DOMAIN}`],
			})

			// WHEN it is taken in
			await runIngest(
				persistIn(parsed, { folder: 'Sent', direction: 'outbound' }),
			)

			// THEN it belongs to the company we wrote to, and so does the
			// conversation it opens — which is never re-homed later, so getting
			// this wrong would keep the whole thread off their page for good
			const row = await fetchMessage(messageId)
			expect(row?.company_id).toBe(acmeCompanyId)
			expect(row?.contact_id).toBe(aliceContactId)
			expect((await fetchThreadLink(messageId))?.company_id).toBe(acmeCompanyId)
		})
	})

	describe('when a company wrote to us', () => {
		it('should still file it under the sender', async () => {
			// GIVEN a message that arrived from that contact
			const messageId = `<from-acme-${randomUUID()}@example>`
			const parsed = buildParsed({
				messageId,
				fromAddress: `alice@${ACME_DOMAIN}`,
				toAddresses: [`inbox@${ACME_DOMAIN}`],
			})

			// WHEN it is taken in
			await runIngest(persist(parsed))

			// THEN it is filed under them
			const row = await fetchMessage(messageId)
			expect(row?.company_id).toBe(acmeCompanyId)
			expect(row?.contact_id).toBe(aliceContactId)
		})
	})
})
