// A message we sent comes back out of the sent folder. The server stored its
// files and listed them when it sent it, so taking it in again must not store
// a second copy of each — those copies would sit in storage with nothing
// pointing at them. A sent message the server listed no files for still gets
// its files stored here, as before.
//
// Prereq: `pnpm cli services up` and a migrated database.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ParticipantMatcher } from '@batuda/email/participant-matcher'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from './db.js'
import { ingestRawMessage } from './ingest.js'
import { RawMessageStorage } from './storage.js'

const ORG_ID = `sent-files-org-${randomUUID()}`
const DOMAIN = `sent-files-${randomUUID()}.example`

let inboxId = ''

// Which attachments were stored, by key.
const storedAttachments: Array<string> = []
const recordingStorage = Layer.succeed(RawMessageStorage, {
	putRaw: () => Effect.void,
	putAttachment: (key: string) =>
		Effect.sync(() => {
			storedAttachments.push(key)
		}),
} as never)

const sqlOnly = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

// A sent message with one attached file, as it sits in the sent folder.
const sentWithFile = (messageId: string): Uint8Array => {
	const boundary = 'sent-files-boundary'
	return new TextEncoder().encode(
		[
			`From: desk@${DOMAIN}`,
			`To: someone@${DOMAIN}`,
			`Message-ID: ${messageId}`,
			`Subject: Quote attached`,
			`Content-Type: multipart/mixed; boundary="${boundary}"`,
			``,
			`--${boundary}`,
			`Content-Type: text/plain; charset=utf-8`,
			``,
			`Here is the quote.`,
			``,
			`--${boundary}`,
			`Content-Type: text/plain; name="quote.txt"`,
			`Content-Disposition: attachment; filename="quote.txt"`,
			``,
			`total: 40`,
			`--${boundary}--`,
			``,
		].join('\r\n'),
	)
}

// The row the server wrote when it sent the message: no folder position yet,
// and the files it stored, or none.
const recordSent = (messageId: string, attachments: unknown[]) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				INSERT INTO email_messages (
					organization_id, inbox_id, folder, message_id, thread_key, direction,
					received_at, status, status_updated_at, raw_rfc822_ref, attachments
				) VALUES (
					${ORG_ID}, ${inboxId}, 'Sent', ${messageId}, ${messageId}, 'outbound',
					now(), 'normal', now(), ${`raw/${randomUUID()}`},
					${JSON.stringify(attachments)}::jsonb
				)`
		}),
	)

const listedAttachments = (messageId: string) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ attachments: unknown }>`
				SELECT attachments FROM email_messages
				WHERE organization_id = ${ORG_ID} AND message_id = ${messageId}`
			return rows[0]?.attachments
		}),
	)

const ingestFromSent = (messageId: string, uid: number) =>
	Effect.runPromise(
		ingestRawMessage({
			organizationId: ORG_ID,
			inboxId,
			folder: 'Sent',
			direction: 'outbound',
			imapUid: uid,
			imapUidvalidity: 7,
			raw: sentWithFile(messageId),
		}).pipe(
			Effect.provide(recordingStorage),
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
				VALUES (${ORG_ID}, 'Sent Files Test', ${ORG_ID}, now())`
			const placeholder = new Uint8Array([0])
			const inboxes = yield* sql<{ id: string }>`
				INSERT INTO inboxes (
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
		}),
	)
}, 30_000)

beforeEach(() => {
	storedAttachments.length = 0
})

afterAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const table of [
				'timeline_activity',
				'interactions',
				'email_messages',
				'email_thread_links',
				'inboxes',
			]) {
				yield* sql`DELETE FROM ${sql.literal(table)} WHERE organization_id = ${ORG_ID}`
			}
			yield* sql`DELETE FROM "organization" WHERE id = ${ORG_ID}`
		}),
	)
})

describe('ingestRawMessage', () => {
	describe('when a sent message the server already listed files for comes back from the sent folder', () => {
		it('should store no second copy and keep the server’s list', async () => {
			// GIVEN a sent message whose file the server stored and listed
			const messageId = `<sent-listed-${randomUUID()}@example>`
			const serverList = [
				{
					index: 0,
					filename: 'quote.txt',
					contentType: 'text/plain',
					sizeBytes: 9,
					cid: null,
					isInline: false,
					storageKey: `messages/${ORG_ID}/sent/quote`,
				},
			]
			await recordSent(messageId, serverList)

			// WHEN the worker takes it in from the sent folder
			await ingestFromSent(messageId, 801)

			// THEN nothing was stored again, and the list still points at the
			// server's copy
			expect(storedAttachments).toEqual([])
			expect(await listedAttachments(messageId)).toEqual(serverList)
		})
	})

	describe('when a sent message the server listed no files for comes back from the sent folder', () => {
		it('should store its files and list them', async () => {
			// GIVEN a sent message recorded with no files
			const messageId = `<sent-unlisted-${randomUUID()}@example>`
			await recordSent(messageId, [])

			// WHEN the worker takes it in from the sent folder
			await ingestFromSent(messageId, 802)

			// THEN its file is stored here and listed on the message
			expect(storedAttachments).toHaveLength(1)
			const listed = (await listedAttachments(messageId)) as Array<{
				filename: string
			}>
			expect(listed.map(a => a.filename)).toEqual(['quote.txt'])
		})
	})
})
