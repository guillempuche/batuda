// Live-DB integration test for `applyBounce` — the path that runs when a
// message we sent comes back undelivered.
//
// The history row it writes has to name its organization: without that the
// database refuses the write, and because it shares a transaction with
// storing the bounce notice, the notice is discarded along with it and never
// reaches the inbox.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on $DATABASE_URL.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { PgClient } from '@effect/sql-pg'
import { Config, Effect, Redacted } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyBounce, type ParsedBounce } from './bounces.js'

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

const ORG_ID = `bounce-org-${randomUUID()}`
const DOMAIN = `bounce-${randomUUID()}.example`

let pool: pg.Pool
let inboxId: string
let companyId: string
let contactId: string

const apply = (bounce: ParsedBounce) =>
	Effect.runPromise(
		applyBounce({ organizationId: ORG_ID, bounce }).pipe(
			Effect.provide(PgLive),
		),
	)

/** An outbound message we can bounce, returning its RFC-5322 Message-ID. */
const seedOutbound = async (): Promise<string> => {
	const messageId = `<sent-${randomUUID()}@${DOMAIN}>`
	await pool.query(
		`INSERT INTO email_messages (
			organization_id, inbox_id, folder, message_id, subject, received_at,
			raw_rfc822_ref, status, status_updated_at, direction, company_id, contact_id
		) VALUES ($1, $2, 'SENT', $3, 'Quote', now(), 'sentinel', 'normal', now(), 'outbound', $4, $5)`,
		[ORG_ID, inboxId, messageId, companyId, contactId],
	)
	return messageId
}

const bounceFor = (
	messageId: string | null,
	recipients: readonly string[],
): ParsedBounce => ({
	originalMessageId: messageId,
	recipients,
	statusCode: '5.1.1',
	diagnostic: 'mailbox unavailable',
	bounceType: 'hard',
})

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })

	// The transport columns are all required; the values are inert — this
	// suite never connects to a mail server.
	const inbox = await pool.query<{ id: string }>(
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
		[ORG_ID, `bounce-user-${randomUUID()}`, `desk@${DOMAIN}`],
	)
	inboxId = inbox.rows[0]!.id

	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name) VALUES ($1, $2, $2) RETURNING id`,
		[ORG_ID, `bounce-co-${randomUUID()}`],
	)
	companyId = company.rows[0]!.id

	const contact = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name) VALUES ($1, $2, 'Bounce Target') RETURNING id`,
		[ORG_ID, companyId],
	)
	contactId = contact.rows[0]!.id

	await pool.query(
		`INSERT INTO contact_channels (organization_id, contact_id, kind, value, is_primary)
		 VALUES ($1, $2, 'email', $3, true)`,
		[ORG_ID, contactId, `nobody@${DOMAIN}`],
	)
})

afterAll(async () => {
	// organization_id is a plain column, so one delete per table clears the suite.
	for (const table of [
		'timeline_activity',
		'email_messages',
		'contact_channels',
		'contacts',
		'companies',
		'inboxes',
	]) {
		await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
			ORG_ID,
		])
	}
	await pool.end()
})

describe('applyBounce', () => {
	describe('when a bounce matches a message we sent', () => {
		it('should mark that message as bounced', async () => {
			// GIVEN a message we sent, and a bounce naming it
			const messageId = await seedOutbound()

			// WHEN the bounce is applied
			const result = await apply(bounceFor(messageId, [`nobody@${DOMAIN}`]))

			// THEN the original is recorded as undelivered, with the reason
			expect(result.matchedOriginal).toBe(true)
			const stored = await pool.query<{
				status: string
				bounce_type: string | null
				bounce_sub_type: string | null
			}>(
				`SELECT status, bounce_type, bounce_sub_type FROM email_messages WHERE message_id = $1`,
				[messageId],
			)
			expect(stored.rows[0]?.status).toBe('bounced')
			expect(stored.rows[0]?.bounce_type).toBe('hard')
			expect(stored.rows[0]?.bounce_sub_type).toBe('5.1.1')
		})

		it('should put the bounce on the company history under this organization', async () => {
			// GIVEN a message we sent to an address we hold a contact for
			const messageId = await seedOutbound()

			// WHEN the bounce is applied
			await apply(bounceFor(messageId, [`nobody@${DOMAIN}`]))

			// THEN a history row exists, carrying the organization and the
			// contact it concerns. Omitting the organization is refused by the
			// database and would discard the surrounding write with it.
			const rows = await pool.query<{
				kind: string
				organization_id: string
				contact_id: string | null
				company_id: string | null
			}>(
				`SELECT t.kind, t.organization_id, t.contact_id, t.company_id
				 FROM timeline_activity t
				 JOIN email_messages m ON m.id = t.entity_id
				 WHERE m.message_id = $1`,
				[messageId],
			)
			expect(rows.rows.length).toBeGreaterThan(0)
			const row = rows.rows[0]
			expect(row?.kind).toBe('email_bounced')
			expect(row?.organization_id).toBe(ORG_ID)
			expect(row?.contact_id).toBe(contactId)
			expect(row?.company_id).toBe(companyId)
		})

		it('should still record a bounce for an address matching no contact', async () => {
			// GIVEN a bounce for someone we hold no contact for
			const messageId = await seedOutbound()

			// WHEN it is applied
			const result = await apply(
				bounceFor(messageId, [`stranger@${randomUUID()}.example`]),
			)

			// THEN no contact is touched, but the bounce is not silent
			expect(result.contactsTouched).toBe(0)
			const rows = await pool.query<{ contact_id: string | null }>(
				`SELECT t.contact_id FROM timeline_activity t
				 JOIN email_messages m ON m.id = t.entity_id
				 WHERE m.message_id = $1`,
				[messageId],
			)
			expect(rows.rows.length).toBe(1)
			expect(rows.rows[0]?.contact_id).toBeNull()
		})
	})

	describe('when the bounce names nothing we sent', () => {
		it('should do nothing rather than guess', async () => {
			// GIVEN a bounce naming a message id we never sent
			const bounce = bounceFor(`<unknown-${randomUUID()}@nowhere>`, [
				`nobody@${DOMAIN}`,
			])

			// WHEN it is applied
			const result = await apply(bounce)

			// THEN nothing is matched and no history is written
			expect(result.matchedOriginal).toBe(false)
			expect(result.contactsTouched).toBe(0)
		})

		it('should ignore a bounce carrying no message id or no recipients', async () => {
			// GIVEN the two degenerate shapes a parser can hand back
			// WHEN each is applied
			const noId = await apply(bounceFor(null, ['a@b.test']))
			const noRecipients = await apply(bounceFor('<x@y>', []))

			// THEN both are refused before any write
			expect(noId.matchedOriginal).toBe(false)
			expect(noRecipients.matchedOriginal).toBe(false)
		})
	})
})
