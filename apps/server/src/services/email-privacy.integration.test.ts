// Mail in a private mailbox belongs to the person who owns it.
//
// The rule lives in the database (migration 0073), so this suite asks the
// service the way a request does — as the owner, and as a colleague in the same
// organisation — and checks that the colleague is answered as though the mail
// were not there. What makes it worth a live database is the pair of cases that
// look alike and must part company: a private message inside a conversation the
// team shares disappears on its own, while a shared conversation that happens to
// have begun in a private mailbox stays, under the mailbox the team can see.
//
// Prereq: `pnpm cli services up` and `pnpm cli db migrate`.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { DateTime, Effect, Exit } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EmailService } from './email.js'
import { makeOrgRuntime, scopedAsOrg } from './email-harness.js'

const DATABASE_URL = process.env['DATABASE_URL'] as string

const ORG_ID = `email-privacy-${randomUUID().slice(0, 8)}`
const OWNER = 'privacy-owner'
const COLLEAGUE = 'privacy-colleague'

const asOwner = {
	orgId: ORG_ID,
	orgName: 'Privacy Test',
	orgSlug: 'privacy-test',
	userId: OWNER,
} as const
const asColleague = { ...asOwner, userId: COLLEAGUE } as const

const ownerRuntime = makeOrgRuntime(asOwner)
const colleagueRuntime = makeOrgRuntime(asColleague)

let pool: pg.Pool
let sharedInboxId: string
let privateInboxId: string
let sharedThreadId: string
let privateThreadId: string
let privateMessageId: string
let sharedMessageId: string

const SHARED_THREAD_KEY = `<shared-${ORG_ID}@privacy.test>`
const PRIVATE_THREAD_KEY = `<private-${ORG_ID}@privacy.test>`

const insertInbox = async (args: {
	readonly email: string
	readonly isPrivate: boolean
}): Promise<string> => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, is_private,
		  imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security,
		  username, password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, $2, $3, $4,
		         'imap.test', 993, 'tls', 'smtp.test', 465, 'tls',
		         $3, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG_ID, OWNER, args.email, args.isPrivate],
	)
	return rows.rows[0]!.id
}

const insertThread = async (args: {
	readonly threadKey: string
	readonly inboxId: string
	readonly subject: string
}): Promise<string> => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO email_thread_links (organization_id, external_thread_id, inbox_id, subject, status)
		 VALUES ($1, $2, $3, $4, 'open') RETURNING id`,
		[ORG_ID, args.threadKey, args.inboxId, args.subject],
	)
	return rows.rows[0]!.id
}

const insertMessage = async (args: {
	readonly threadKey: string
	readonly inboxId: string
	readonly subject: string
	readonly body: string
	readonly from: string
	readonly direction?: 'inbound' | 'outbound'
	readonly receivedAt?: string
}): Promise<string> => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO email_messages
		 (organization_id, inbox_id, message_id, thread_key, direction, folder,
		  raw_rfc822_ref, subject, received_at, text_preview, text_body, status,
		  attachments)
		 VALUES ($1, $2, $3, $4, $5, 'INBOX', 'privacy-test', $6, $7, $8, $8, 'normal',
		         '[{"index":0,"filename":"note.pdf","contentType":"application/pdf","sizeBytes":10,"cid":null,"isInline":false,"storageKey":"k"}]'::jsonb)
		 RETURNING id`,
		[
			ORG_ID,
			args.inboxId,
			`<msg-${randomUUID()}@privacy.test>`,
			args.threadKey,
			args.direction ?? 'inbound',
			args.subject,
			args.receivedAt ?? new Date().toISOString(),
			args.body,
		],
	)
	const id = rows.rows[0]!.id
	await pool.query(
		`INSERT INTO message_participants (email_message_id, email_address, role)
		 VALUES ($1, $2, 'from')`,
		[id, args.from],
	)
	return id
}

/** The day a thread's latest message is dated, as the list hands it over. */
const dayOf = (at: DateTime.Utc | null | undefined): string | null =>
	at == null ? null : DateTime.toDateUtc(at).toISOString().slice(0, 10)

type Viewer = {
	readonly orgId: string
	readonly orgName: string
	readonly orgSlug: string
	readonly userId: string
}

const listThreadsAs = (runtime: typeof ownerRuntime, who: Viewer) =>
	runtime.runPromise(
		scopedAsOrg(
			who,
			Effect.gen(function* () {
				const emails = yield* EmailService
				return yield* emails.listThreads({ count: 'exact' })
			}),
		),
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })

	sharedInboxId = await insertInbox({
		email: `team-${ORG_ID}@privacy.test`,
		isPrivate: false,
	})
	privateInboxId = await insertInbox({
		email: `mine-${ORG_ID}@privacy.test`,
		isPrivate: true,
	})

	// A conversation the team shares, which also holds one message that
	// arrived in the owner's private mailbox.
	sharedThreadId = await insertThread({
		threadKey: SHARED_THREAD_KEY,
		inboxId: sharedInboxId,
		subject: 'Quote for the roof',
	})
	sharedMessageId = await insertMessage({
		threadKey: SHARED_THREAD_KEY,
		inboxId: sharedInboxId,
		subject: 'Quote for the roof',
		body: 'the shared roof quote',
		from: 'client@customer.test',
		receivedAt: '2026-09-01T09:00:00Z',
	})
	privateMessageId = await insertMessage({
		threadKey: SHARED_THREAD_KEY,
		inboxId: privateInboxId,
		subject: 'Quote for the roof',
		body: 'sensitive discount wording',
		from: 'lawyer@confidential.test',
		receivedAt: '2026-09-02T09:00:00Z',
	})

	// A conversation that is only ever in the private mailbox.
	privateThreadId = await insertThread({
		threadKey: PRIVATE_THREAD_KEY,
		inboxId: privateInboxId,
		subject: 'Personal matter',
	})
	await insertMessage({
		threadKey: PRIVATE_THREAD_KEY,
		inboxId: privateInboxId,
		subject: 'Personal matter',
		body: 'a private conversation',
		from: 'friend@confidential.test',
	})
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
	await ownerRuntime.dispose()
	await colleagueRuntime.dispose()
})

describe('EmailService privacy [email.ts]', () => {
	describe('when a colleague lists conversations', () => {
		it('should show the shared conversation and hide the private one', async () => {
			// GIVEN one shared conversation and one only in a private mailbox
			// WHEN a colleague lists them
			const page = await listThreadsAs(colleagueRuntime, asColleague)
			const ids = page.items.map(t => t.id)
			// THEN only the shared one is there, and the count agrees
			expect(ids).toContain(sharedThreadId)
			expect(ids).not.toContain(privateThreadId)
			expect(page.total).toBe(ids.length)
		})

		it('should count only the messages it may read', async () => {
			// GIVEN the shared conversation holds two messages, one of them private
			// WHEN a colleague lists conversations
			const page = await listThreadsAs(colleagueRuntime, asColleague)
			const thread = page.items.find(t => t.id === sharedThreadId)
			// THEN it says one message, dated by the message they may read
			expect(thread?.messageCount).toBe(1)
			expect(dayOf(thread?.lastMessageAt)).toBe('2026-09-01')
		})
	})

	describe('when the owner lists conversations', () => {
		it('should show both conversations and every message', async () => {
			// GIVEN the same two conversations
			// WHEN their mailbox's owner lists them
			const page = await listThreadsAs(ownerRuntime, asOwner)
			const ids = page.items.map(t => t.id)
			const thread = page.items.find(t => t.id === sharedThreadId)
			// THEN both are there, with the private message counted and latest
			expect(ids).toEqual(
				expect.arrayContaining([sharedThreadId, privateThreadId]),
			)
			expect(thread?.messageCount).toBe(2)
			expect(dayOf(thread?.lastMessageAt)).toBe('2026-09-02')
		})
	})

	describe('when a colleague searches for a word only in private mail', () => {
		it('should find nothing', async () => {
			// GIVEN "discount" appears only in the private message
			// WHEN a colleague searches for it
			const page = await colleagueRuntime.runPromise(
				scopedAsOrg(
					asColleague,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.listThreads({ query: 'discount' })
					}),
				),
			)
			// THEN the shared conversation is not offered up by it
			expect(page.items).toEqual([])
		})

		it('should still find the same word for the owner', async () => {
			// GIVEN the same word
			// WHEN the mailbox's owner searches
			const page = await ownerRuntime.runPromise(
				scopedAsOrg(
					asOwner,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.listThreads({ query: 'discount' })
					}),
				),
			)
			// THEN the conversation holding it comes back
			expect(page.items.map(t => t.id)).toContain(sharedThreadId)
		})
	})

	describe('when a colleague opens the shared conversation', () => {
		it('should leave the private message out of it', async () => {
			// GIVEN the conversation holds a private message
			// WHEN a colleague opens it
			const thread = await colleagueRuntime.runPromise(
				scopedAsOrg(
					asColleague,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.getThread(sharedThreadId)
					}),
				),
			)
			// THEN they read only the message they may see
			expect(thread.messages).toHaveLength(1)
			expect(JSON.stringify(thread.messages)).not.toContain('sensitive')
		})
	})

	describe('when a shared conversation began in a private mailbox', () => {
		it('should not name that mailbox to a colleague', async () => {
			// GIVEN a conversation whose first message came into Alice's private
			// mailbox, and a later one into the team's
			const key = `<began-private-${ORG_ID}@privacy.test>`
			const threadId = await insertThread({
				threadKey: key,
				inboxId: privateInboxId,
				subject: 'Started privately',
			})
			await insertMessage({
				threadKey: key,
				inboxId: privateInboxId,
				subject: 'Started privately',
				body: 'the private opener',
				from: 'lawyer@confidential.test',
				receivedAt: '2026-09-03T09:00:00Z',
			})
			await insertMessage({
				threadKey: key,
				inboxId: sharedInboxId,
				subject: 'Started privately',
				body: 'the shared follow-up',
				from: 'client@customer.test',
				receivedAt: '2026-09-04T09:00:00Z',
			})

			// WHEN a colleague opens it, which they may: it holds a message of
			// theirs to read
			const thread = await colleagueRuntime.runPromise(
				scopedAsOrg(
					asColleague,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.getThread(threadId)
					}),
				),
			)

			// THEN the mailbox they are shown is the one their message arrived in,
			// and nothing names the private one: its address would say who keeps a
			// private mailbox, and its subject what they were written to about
			expect(thread.inbox?.email).toBe(`team-${ORG_ID}@privacy.test`)
			expect(JSON.stringify(thread)).not.toContain(`mine-${ORG_ID}`)
			expect(JSON.stringify(thread)).not.toContain('the private opener')
		})

		it('should still name it to the mailbox owner', async () => {
			// GIVEN the same conversation
			const page = await listThreadsAs(ownerRuntime, asOwner)
			const thread = page.items.find(t => t.subject === 'Started privately')
			// WHEN its owner reads the list
			// THEN they see it under their own mailbox
			expect(thread?.inbox?.email).toBe(`mine-${ORG_ID}@privacy.test`)
		})
	})

	describe('when a colleague opens a conversation of private mail', () => {
		it('should answer not found', async () => {
			// GIVEN a conversation only in the owner's private mailbox
			// WHEN a colleague opens it by id
			const exit = await colleagueRuntime.runPromiseExit(
				scopedAsOrg(
					asColleague,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.getThread(privateThreadId)
					}),
				),
			)
			// THEN it reads the same as a conversation that never existed
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when a colleague lists message records', () => {
		it('should leave private messages out of the items and the count', async () => {
			// GIVEN two messages, one of them in a private mailbox
			// WHEN a colleague lists message records
			const page = await colleagueRuntime.runPromise(
				scopedAsOrg(
					asColleague,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.listMessages({ count: 'exact' })
					}),
				),
			)
			const ids = page.items.map(m => m.id)
			// THEN only the shared one is listed, and the total says so too
			expect(ids).toContain(sharedMessageId)
			expect(ids).not.toContain(privateMessageId)
			expect(page.total).toBe(ids.length)
		})
	})

	describe('when a colleague asks for a private message by id', () => {
		it('should answer not found', async () => {
			// GIVEN the id of a message in somebody else's private mailbox
			// WHEN a colleague asks for it
			const exit = await colleagueRuntime.runPromiseExit(
				scopedAsOrg(
					asColleague,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.getMessage(privateMessageId)
					}),
				),
			)
			// THEN it reads the same as an id that never existed
			expect(Exit.isFailure(exit)).toBe(true)
		})

		it('should hand it to the mailbox owner', async () => {
			// GIVEN the same id
			// WHEN its mailbox's owner asks for it
			const record = await ownerRuntime.runPromise(
				scopedAsOrg(
					asOwner,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.getMessage(privateMessageId)
					}),
				),
			)
			// THEN they get the message
			expect(record.id).toBe(privateMessageId)
		})
	})

	describe('when a colleague downloads an attachment from private mail', () => {
		it('should answer not found', async () => {
			// GIVEN a private message carrying an attachment
			// WHEN a colleague asks for its first attachment
			const exit = await colleagueRuntime.runPromiseExit(
				scopedAsOrg(
					asColleague,
					Effect.gen(function* () {
						const emails = yield* EmailService
						return yield* emails.streamAttachment(privateMessageId, '0')
					}),
				),
			)
			// THEN nothing is served
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when a colleague changes a private conversation', () => {
		it('should change nothing', async () => {
			// GIVEN a conversation of private mail, open
			// WHEN a colleague closes it by id
			await colleagueRuntime
				.runPromiseExit(
					scopedAsOrg(
						asColleague,
						Effect.gen(function* () {
							const emails = yield* EmailService
							return yield* emails.updateThreadStatus(privateThreadId, 'closed')
						}),
					),
				)
				.catch(() => undefined)
			// THEN the conversation is still open
			const rows = await pool.query<{ status: string }>(
				`SELECT status FROM email_thread_links WHERE id = $1`,
				[privateThreadId],
			)
			expect(rows.rows[0]?.status).toBe('open')
		})
	})

	describe('when a mailbox is made private after the fact', () => {
		it('should hide its mail from colleagues at once', async () => {
			// GIVEN a shared mailbox a colleague can read mail from
			const before = await listThreadsAs(colleagueRuntime, asColleague)
			expect(before.items.map(t => t.id)).toContain(sharedThreadId)
			// WHEN the mailbox is made private
			await pool.query(`UPDATE inboxes SET is_private = true WHERE id = $1`, [
				sharedInboxId,
			])
			// THEN the colleague no longer sees the conversation
			const after = await listThreadsAs(colleagueRuntime, asColleague)
			expect(after.items.map(t => t.id)).not.toContain(sharedThreadId)
			// AND the owner still does
			const owner = await listThreadsAs(ownerRuntime, asOwner)
			expect(owner.items.map(t => t.id)).toContain(sharedThreadId)
			await pool.query(`UPDATE inboxes SET is_private = false WHERE id = $1`, [
				sharedInboxId,
			])
		})
	})
})
