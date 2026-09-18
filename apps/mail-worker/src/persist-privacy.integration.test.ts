// What storing a message does around a private mailbox.
//
// Three rules, all of them about not saying something to the team that only
// the mailbox's owner should hear:
//
//   - mail into a private mailbox leaves a conversation the team shares
//     exactly as it was, neither moving it to the top of everybody's list nor
//     naming it after a message they cannot read;
//   - the same message reaching both a private and a shared mailbox is stored
//     once, and ends up filed under the shared one, so the team keeps sight of
//     mail their own mailbox received;
//   - a delivery failure notice is marked as one, so it is not read as the
//     other side writing back.
//
// Prereq: `pnpm cli services up` and `pnpm cli db migrate`.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { PgClient } from '@effect/sql-pg'
import { Config, Effect, Redacted } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ParticipantMatcher } from '@batuda/email/participant-matcher'
import { TimelineActivityService } from '@batuda/timeline'

import { type ParsedInbound, persistMessage } from './persist.js'

const DATABASE_URL = process.env['DATABASE_URL'] as string

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

const ORG_ID = `persist-privacy-${randomUUID().slice(0, 8)}`
const DOMAIN = `client-${randomUUID().slice(0, 8)}.test`

let pool: pg.Pool
let sharedInboxId: string
let privateInboxId: string
let nextUid = 1000

const insertInbox = async (email: string, isPrivate: boolean) => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, is_private,
		  imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security,
		  username, password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, 'mailbox-owner', $2, $3, 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls',
		         $2, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG_ID, email, isPrivate],
	)
	return rows.rows[0]!.id
}

const message = (args: {
	readonly messageId: string
	readonly subject: string | null
	readonly references?: ReadonlyArray<string>
}): ParsedInbound => ({
	messageId: args.messageId,
	inReplyTo: args.references?.[0] ?? null,
	references: [...(args.references ?? [])],
	subject: args.subject,
	fromAddress: `them@${DOMAIN}`,
	toAddresses: [`team@${DOMAIN}`],
	ccAddresses: [],
	bccAddresses: [],
	receivedAt: new Date(),
	textBody: 'hello',
	htmlBody: null,
	textPreview: 'hello',
})

const store = (args: {
	readonly parsed: ParsedInbound
	readonly inboxId: string
	readonly isDeliveryNotice?: boolean
}) =>
	Effect.runPromise(
		persistMessage({
			organizationId: ORG_ID,
			inboxId: args.inboxId,
			folder: 'INBOX',
			direction: 'inbound',
			imapUid: nextUid++,
			imapUidvalidity: 100,
			rawRfc822Ref: 'sentinel',
			parsed: args.parsed,
			attachments: [],
			...(args.isDeliveryNotice !== undefined && {
				isDeliveryNotice: args.isDeliveryNotice,
			}),
		}).pipe(
			Effect.provide(ParticipantMatcher.layer),
			Effect.provide(TimelineActivityService.layer),
			Effect.provide(PgLive),
		),
	)

const threadRow = async (threadKey: string) => {
	const rows = await pool.query<{
		subject: string | null
		updatedAt: Date
		inboxId: string
	}>(
		`SELECT subject, updated_at AS "updatedAt", inbox_id AS "inboxId"
		 FROM email_thread_links
		 WHERE organization_id = $1 AND external_thread_id = $2`,
		[ORG_ID, threadKey],
	)
	return rows.rows[0]!
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	sharedInboxId = await insertInbox(`team-${ORG_ID}@ours.test`, false)
	privateInboxId = await insertInbox(`mine-${ORG_ID}@ours.test`, true)
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM message_participants WHERE email_message_id IN
		   (SELECT id FROM email_messages WHERE organization_id = $1)`,
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
})

describe('persistMessage and private mailboxes [persist.ts]', () => {
	describe('when mail arrives in a private mailbox on a conversation the team shares', () => {
		it('should leave the conversation where it was in everyone else list', async () => {
			// GIVEN a conversation the team shares, started in the shared mailbox
			const root = `<shared-root-${ORG_ID}@${DOMAIN}>`
			await store({
				parsed: message({ messageId: root, subject: 'Roof quote' }),
				inboxId: sharedInboxId,
			})
			const before = await threadRow(root)

			// WHEN a reply arrives in somebody's private mailbox
			await store({
				parsed: message({
					messageId: `<private-reply-${ORG_ID}@${DOMAIN}>`,
					subject: 'Roof quote',
					references: [root],
				}),
				inboxId: privateInboxId,
			})

			// THEN the conversation has not moved to the top of the list
			const after = await threadRow(root)
			expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
		})

		it('should not name an unnamed conversation after a private message', async () => {
			// GIVEN a conversation the team shares with no subject of its own
			const root = `<unnamed-${ORG_ID}@${DOMAIN}>`
			await store({
				parsed: message({ messageId: root, subject: null }),
				inboxId: sharedInboxId,
			})

			// WHEN a message with a subject arrives in a private mailbox
			await store({
				parsed: message({
					messageId: `<private-named-${ORG_ID}@${DOMAIN}>`,
					subject: 'What we settled privately',
					references: [root],
				}),
				inboxId: privateInboxId,
			})

			// THEN the shared conversation is still unnamed: its subject would be
			// read by people who cannot read the message it came from
			const after = await threadRow(root)
			expect(after.subject).toBeNull()
		})
	})

	describe('when a message reaches a private mailbox and a shared one', () => {
		it('should file it under the shared mailbox once the shared copy arrives', async () => {
			// GIVEN a message read first from the private mailbox
			const both = `<both-${ORG_ID}@${DOMAIN}>`
			await store({
				parsed: message({ messageId: both, subject: 'Copied in' }),
				inboxId: privateInboxId,
			})

			// WHEN the same message is read from the shared mailbox
			await store({
				parsed: message({ messageId: both, subject: 'Copied in' }),
				inboxId: sharedInboxId,
			})

			// THEN the one stored copy now sits in the shared mailbox, so the team
			// keeps sight of mail their own mailbox received
			const rows = await pool.query<{ inboxId: string; count: string }>(
				`SELECT inbox_id AS "inboxId", count(*) OVER () AS count
				 FROM email_messages WHERE organization_id = $1 AND message_id = $2`,
				[ORG_ID, both],
			)
			expect(rows.rows).toHaveLength(1)
			expect(rows.rows[0]?.inboxId).toBe(sharedInboxId)
		})

		it('should leave a shared message where it is when a private copy turns up', async () => {
			// GIVEN a message read first from the shared mailbox
			const shared = `<shared-first-${ORG_ID}@${DOMAIN}>`
			await store({
				parsed: message({ messageId: shared, subject: 'Team first' }),
				inboxId: sharedInboxId,
			})

			// WHEN the same message is read from a private mailbox
			await store({
				parsed: message({ messageId: shared, subject: 'Team first' }),
				inboxId: privateInboxId,
			})

			// THEN it stays in the shared mailbox
			const rows = await pool.query<{ inboxId: string }>(
				`SELECT inbox_id AS "inboxId" FROM email_messages
				 WHERE organization_id = $1 AND message_id = $2`,
				[ORG_ID, shared],
			)
			expect(rows.rows[0]?.inboxId).toBe(sharedInboxId)
		})
	})

	describe('when the message is a delivery failure notice', () => {
		it('should mark it as one', async () => {
			// GIVEN a notice from a mail server
			const notice = `<notice-${ORG_ID}@${DOMAIN}>`
			// WHEN it is stored
			await store({
				parsed: message({ messageId: notice, subject: 'Undelivered Mail' }),
				inboxId: sharedInboxId,
				isDeliveryNotice: true,
			})

			// THEN the row says so, and ordinary mail does not
			const rows = await pool.query<{ isDeliveryNotice: boolean }>(
				`SELECT is_delivery_notice AS "isDeliveryNotice" FROM email_messages
				 WHERE organization_id = $1 AND message_id = $2`,
				[ORG_ID, notice],
			)
			expect(rows.rows[0]?.isDeliveryNotice).toBe(true)
		})
	})

	describe('when any message is stored', () => {
		it('should say which conversation it belongs to', async () => {
			// GIVEN a reply to a conversation
			const root = `<keyed-root-${ORG_ID}@${DOMAIN}>`
			await store({
				parsed: message({ messageId: root, subject: 'Keyed' }),
				inboxId: sharedInboxId,
			})
			const reply = `<keyed-reply-${ORG_ID}@${DOMAIN}>`
			// WHEN the reply is stored
			await store({
				parsed: message({
					messageId: reply,
					subject: 'Keyed',
					references: [root],
				}),
				inboxId: sharedInboxId,
			})

			// THEN both rows carry the conversation's own key, which is how every
			// read finds them
			const rows = await pool.query<{ threadKey: string }>(
				`SELECT thread_key AS "threadKey" FROM email_messages
				 WHERE organization_id = $1 AND message_id IN ($2, $3)`,
				[ORG_ID, root, reply],
			)
			expect(rows.rows.map(r => r.threadKey)).toEqual([root, root])
		})
	})
})
