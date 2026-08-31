// Taking the same message in twice must not count it twice.
//
// A mailbox whose uid numbering resets is read again from the start, so every
// message in the window arrives a second time. Storing one is already idempotent
// — the dedupe index turns the second insert into a no-op — but what a message
// *means* for the rest of the account is not: a delivery notice moves an
// address closer to being suppressed, and applying one twice counts a failure
// that only happened once.
//
// Prereq: `pnpm cli services up` and a migrated database.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ParticipantMatcher } from '@batuda/email/participant-matcher'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from './db.js'
import { ingestRawMessage } from './ingest.js'
import { RawMessageStorage } from './storage.js'

const ORG_ID = `replay-org-${randomUUID()}`
const DOMAIN = `replay-${randomUUID()}.example`
const BOUNCED = `gone@${DOMAIN}`

let inboxId = ''
let contactId = ''
const originalMessageId = `<replay-original-${randomUUID()}@example>`

// The bytes never leave the test — what is under test is what the database ends
// up holding, not where the raw message was put.
const stubStorage = Layer.succeed(RawMessageStorage, {
	putRaw: () => Effect.void,
	putAttachment: () => Effect.void,
} as never)

const sqlOnly = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

// One delivery notice, as a mail server writes it: RFC 3464 multipart/report
// naming the address that failed and quoting the message that did not arrive.
const deliveryNotice = (): Uint8Array => {
	const boundary = 'replay-boundary'
	return new TextEncoder().encode(
		[
			`From: MAILER-DAEMON@${DOMAIN}`,
			`To: desk@${DOMAIN}`,
			`Message-ID: <replay-dsn-${randomUUID()}@example>`,
			`Subject: Undelivered Mail Returned to Sender`,
			`Content-Type: multipart/report; report-type=delivery-status; boundary="${boundary}"`,
			``,
			`--${boundary}`,
			`Content-Type: text/plain; charset=utf-8`,
			``,
			`Delivery to the following recipient failed.`,
			``,
			`--${boundary}`,
			`Content-Type: message/delivery-status`,
			``,
			`Reporting-MTA: dns; mta.${DOMAIN}`,
			``,
			`Final-Recipient: rfc822;${BOUNCED}`,
			`Action: failed`,
			`Status: 4.2.2`,
			``,
			`--${boundary}`,
			`Content-Type: message/rfc822`,
			``,
			`Message-ID: ${originalMessageId}`,
			`To: ${BOUNCED}`,
			`Subject: original`,
			``,
			`body bytes`,
			`--${boundary}--`,
			``,
		].join('\r\n'),
	)
}

// The same read of the same mailbox, twice — identical uid and uidvalidity, the
// way a re-read of the window delivers it.
const ingestOnce = (raw: Uint8Array) =>
	Effect.runPromise(
		ingestRawMessage({
			organizationId: ORG_ID,
			inboxId,
			folder: 'INBOX',
			direction: 'inbound',
			imapUid: 501,
			imapUidvalidity: 9,
			raw,
		}).pipe(
			Effect.provide(stubStorage),
			Effect.provide(ParticipantMatcher.layer),
			Effect.provide(TimelineActivityService.layer),
			Effect.provide(PgLive),
		),
	)

beforeAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				INSERT INTO "organization" (id, name, slug, "createdAt")
				VALUES (${ORG_ID}, 'Replay Test', ${ORG_ID}, now())`
			const placeholder = new Uint8Array([0])
			const inboxes = yield* sql<{ id: string }>`
				INSERT INTO inboxes (
					-- A mailbox the whole team shares, which is why it is nobody's
					-- default: the database refuses a team mailbox that is one.
					organization_id, email, is_default, is_private, grant_status,
					imap_host, imap_port, imap_security,
					smtp_host, smtp_port, smtp_security, username,
					password_ciphertext, password_nonce, password_tag
				) VALUES (
					${ORG_ID}, ${`desk@${DOMAIN}`}, false, false, 'connected',
					'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', ${`desk@${DOMAIN}`},
					${placeholder}, ${placeholder}, ${placeholder}
				) RETURNING id`
			inboxId = inboxes[0]!.id
			const companies = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${ORG_ID}, ${`replay-co-${randomUUID()}`}, 'Replay Co')
				RETURNING id`
			const contacts = yield* sql<{ id: string }>`
				INSERT INTO contacts (organization_id, company_id, name)
				VALUES (${ORG_ID}, ${companies[0]!.id}, 'Gone Person')
				RETURNING id`
			contactId = contacts[0]!.id
			yield* sql`
				INSERT INTO channels (
					organization_id, subject_table, subject_id, channel, address, is_primary
				) VALUES (
					${ORG_ID}, 'contacts', ${contactId}, 'email', ${BOUNCED}, true
				)`
			// The message the notice says did not arrive.
			yield* sql`
				INSERT INTO email_messages (
					organization_id, inbox_id, folder, message_id, direction,
					received_at, status, status_updated_at, raw_rfc822_ref
				) VALUES (
					${ORG_ID}, ${inboxId}, 'Sent', ${originalMessageId}, 'outbound',
					now(), 'normal', now(), ${`raw/${randomUUID()}`}
				)`
		}),
	)
}, 30_000)

afterAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const table of [
				'timeline_activity',
				'interactions',
				'email_messages',
				'email_thread_links',
				'channels',
				'contacts',
				'companies',
				'inboxes',
			]) {
				yield* sql`DELETE FROM ${sql.literal(table)} WHERE organization_id = ${ORG_ID}`
			}
			yield* sql`DELETE FROM "organization" WHERE id = ${ORG_ID}`
		}),
	)
})

const bounceEntries = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ id: string }>`
				SELECT id FROM timeline_activity
				WHERE organization_id = ${ORG_ID} AND kind = 'email_bounced'`
			return rows.length
		}),
	)

const softBounceCount = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ softBounceCount: number }>`
				SELECT soft_bounce_count FROM channels
				WHERE organization_id = ${ORG_ID} AND address = ${BOUNCED}`
			return rows[0]?.softBounceCount ?? 0
		}),
	)

describe('taking in a delivery notice that has already been seen', () => {
	describe('when the same notice arrives a second time', () => {
		it('should count the failure once, not twice', async () => {
			// GIVEN a delivery notice for an address we hold a contact for
			const raw = deliveryNotice()

			// WHEN the same read delivers it twice
			await ingestOnce(raw)
			const afterFirst = await softBounceCount()
			await ingestOnce(raw)

			// THEN the address is no closer to being suppressed than one failure
			// puts it. Three counted failures suppress an address, so a mailbox
			// re-read twice would silence somebody who bounced once
			expect(afterFirst).toBe(1)
			expect(await softBounceCount()).toBe(1)
		})

		it('should leave one entry on the history, not one per read', async () => {
			// GIVEN the notice above, already taken in twice
			// THEN the account shows the failure once
			expect(await bounceEntries()).toBe(1)
		})
	})
})
