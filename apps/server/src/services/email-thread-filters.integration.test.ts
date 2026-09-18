// Narrowing a list of conversations.
//
// Every filter here is answered from the messages a conversation holds, worked
// out once by the list and read again by the filters — so what a row says and
// what a filter finds cannot drift apart. That is what this suite pins: each
// filter against data built for it, the combinations that narrow one another,
// and the pairings that can only find nothing.
//
// The ones worth the live database are the ones about time and order: which
// message counts as the latest, what a bounce does to it, and that a message
// carried over from an old mailbox keeps the date its sender wrote on it
// rather than the moment it was stored.
//
// Prereq: `pnpm cli services up` and `pnpm cli db migrate`.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { DateTime, Effect } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EmailService } from './email.js'
import { makeOrgRuntime, scopedAsOrg } from './email-harness.js'
import type { ThreadFilters } from './email-list-filters.js'

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG_ID = `thread-filters-${randomUUID().slice(0, 8)}`

const asUser = {
	orgId: ORG_ID,
	orgName: 'Filters Test',
	orgSlug: 'filters-test',
	userId: 'filters-user',
} as const

const runtime = makeOrgRuntime(asUser)

let pool: pg.Pool
let inboxId: string
let otherInboxId: string
let ownedCompanyId: string
let unownedCompanyId: string

/** Every conversation this suite builds, by the name the tests call it. */
const threads: Record<string, string> = {}

const days = (n: number): string =>
	new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

const search = (filters: ThreadFilters & { count?: 'exact' | 'none' }) =>
	runtime.runPromise(
		scopedAsOrg(
			asUser,
			Effect.gen(function* () {
				const emails = yield* EmailService
				return yield* emails.listThreads(filters)
			}),
		),
	)

/** The conversations a filter found, by their test names, in the order given. */
const found = async (
	filters: ThreadFilters & { count?: 'exact' | 'none' },
): Promise<string[]> => {
	const page = await search(filters)
	const byId = new Map(Object.entries(threads).map(([name, id]) => [id, name]))
	return page.items.map(t => byId.get(t.id) ?? t.id)
}

const insertInbox = async (email: string, isPrivate = false) => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, is_private,
		  imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security,
		  username, password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, $2, $3, $4, 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls',
		         $3, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG_ID, asUser.userId, email, isPrivate],
	)
	return rows.rows[0]!.id
}

const insertCompany = async (slug: string, ownerId: string | null) => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, owner_id, status)
		 VALUES ($1, $2, $2, $3, 'prospect') RETURNING id`,
		[ORG_ID, `${slug}-${ORG_ID}`, ownerId],
	)
	return rows.rows[0]!.id
}

type MessageSpec = {
	readonly direction?: 'inbound' | 'outbound'
	readonly receivedAt?: string
	readonly status?: string
	readonly from?: string
	readonly to?: string
	readonly body?: string
	readonly attachments?: 'none' | 'file' | 'inline'
	readonly deleted?: boolean
	readonly deliveryNotice?: boolean
	readonly classification?: 'spam' | 'blocked'
	readonly inboxId?: string
	readonly storedAt?: string
}

const ATTACHMENTS = {
	none: '[]',
	file: '[{"index":0,"filename":"quote.pdf","contentType":"application/pdf","sizeBytes":9,"cid":null,"isInline":false,"storageKey":"k"}]',
	inline:
		'[{"index":0,"filename":"logo.png","contentType":"image/png","sizeBytes":9,"cid":"logo","isInline":true,"storageKey":"k"}]',
} as const

/** One conversation, its messages, and where it sits in the CRM. */
const seedThread = async (args: {
	readonly name: string
	readonly status?: string
	readonly companyId?: string | null
	readonly readAt?: string | null
	readonly updatedAt?: string
	readonly messages: ReadonlyArray<MessageSpec>
}) => {
	const threadKey = `<${args.name}-${ORG_ID}@filters.test>`
	const link = await pool.query<{ id: string }>(
		`INSERT INTO email_thread_links
		 (organization_id, external_thread_id, inbox_id, company_id, subject, status, last_read_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
		 RETURNING id`,
		[
			ORG_ID,
			threadKey,
			inboxId,
			args.companyId ?? null,
			args.name,
			args.status ?? 'open',
			args.readAt ?? null,
			args.updatedAt ?? null,
		],
	)
	threads[args.name] = link.rows[0]!.id

	for (const [index, message] of args.messages.entries()) {
		const messageId = `<${args.name}-${index}-${ORG_ID}@filters.test>`
		const row = await pool.query<{ id: string }>(
			`INSERT INTO email_messages
			 (organization_id, inbox_id, message_id, thread_key, direction, folder,
			  raw_rfc822_ref, subject, received_at, status_updated_at, text_preview, text_body,
			  status, inbound_classification, attachments, deleted_at, is_delivery_notice)
			 VALUES ($1, $2, $3, $4, $5, 'INBOX', 'filters-test', $6, $7,
			         COALESCE($12::timestamptz, $7::timestamptz), $8, $8, $9, $10, $11::jsonb, $13, $14)
			 RETURNING id`,
			[
				ORG_ID,
				message.inboxId ?? inboxId,
				messageId,
				threadKey,
				message.direction ?? 'inbound',
				args.name,
				message.receivedAt ?? days(1),
				message.body ?? 'a message',
				message.status ?? 'normal',
				message.classification ?? null,
				ATTACHMENTS[message.attachments ?? 'none'],
				message.storedAt ?? null,
				message.deleted === true ? new Date().toISOString() : null,
				message.deliveryNotice === true,
			],
		)
		await pool.query(
			`INSERT INTO message_participants (email_message_id, email_address, role)
			 VALUES ($1, $2, 'from'), ($1, $3, 'to')`,
			[
				row.rows[0]!.id,
				message.from ?? 'client@acme.test',
				message.to ?? 'team@ours.test',
			],
		)
	}
	return threads[args.name]!
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	inboxId = await insertInbox(`team-${ORG_ID}@filters.test`)
	otherInboxId = await insertInbox(`second-${ORG_ID}@filters.test`)
	ownedCompanyId = await insertCompany('owned', asUser.userId)
	unownedCompanyId = await insertCompany('unowned', null)

	// They wrote last: waiting on us.
	await seedThread({
		name: 'needs-reply',
		companyId: ownedCompanyId,
		messages: [
			{ direction: 'outbound', receivedAt: days(6) },
			{ direction: 'inbound', receivedAt: days(2), body: 'any news?' },
		],
	})
	// We wrote last and it went out: waiting on them.
	await seedThread({
		name: 'awaiting-them',
		companyId: unownedCompanyId,
		messages: [
			{ direction: 'inbound', receivedAt: days(9) },
			{ direction: 'outbound', receivedAt: days(3), to: 'buyer@other.test' },
		],
	})
	// We wrote last and it bounced: waiting on nobody.
	await seedThread({
		name: 'bounced',
		messages: [
			{ direction: 'outbound', receivedAt: days(4), status: 'bounced' },
		],
	})
	// They wrote last but the message is junk.
	await seedThread({
		name: 'junk',
		messages: [
			{ direction: 'inbound', receivedAt: days(1), classification: 'spam' },
		],
	})
	// Settled: waiting on nobody, whoever wrote last.
	await seedThread({
		name: 'closed-inbound',
		status: 'closed',
		messages: [{ direction: 'inbound', receivedAt: days(1) }],
	})
	// Quiet for a long time, and read.
	await seedThread({
		name: 'quiet',
		readAt: new Date().toISOString(),
		messages: [
			{ direction: 'inbound', receivedAt: days(40), from: 'old@quiet.test' },
		],
	})
	// A delivery notice arriving after our send does not make it their turn.
	await seedThread({
		name: 'notice',
		messages: [
			{ direction: 'outbound', receivedAt: days(5) },
			{ direction: 'inbound', receivedAt: days(4), deliveryNotice: true },
		],
	})
	// A file somebody attached, and an inline image that is not one.
	await seedThread({
		name: 'with-file',
		messages: [{ attachments: 'file', receivedAt: days(7) }],
	})
	await seedThread({
		name: 'inline-only',
		messages: [{ attachments: 'inline', receivedAt: days(7) }],
	})
	// Stored today, written weeks ago: a mailbox connected with its history.
	await seedThread({
		name: 'backfilled',
		messages: [
			{
				direction: 'inbound',
				receivedAt: days(30),
				storedAt: new Date().toISOString(),
			},
		],
	})
	// The newest message was deleted from the mailbox.
	await seedThread({
		name: 'deleted-latest',
		messages: [
			{ direction: 'outbound', receivedAt: days(8) },
			{ direction: 'inbound', receivedAt: days(1), deleted: true },
		],
	})
	// Somewhere else entirely.
	await seedThread({
		name: 'second-mailbox',
		messages: [{ inboxId: otherInboxId, receivedAt: days(2) }],
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
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG_ID])
	await pool.query(`DELETE FROM inboxes WHERE organization_id = $1`, [ORG_ID])
	await pool.end()
	await runtime.dispose()
})

describe('EmailService.listThreads filters [email-list-filters.ts]', () => {
	describe('when asked who is waiting for an answer', () => {
		it('should count a conversation whose latest message came in', async () => {
			// GIVEN conversations in every state
			// WHEN asking what needs a reply
			const names = await found({ waitingOn: 'us' })
			// THEN only the open one they wrote to last
			expect(names).toContain('needs-reply')
			expect(names).not.toContain('awaiting-them')
		})

		it('should leave out one that is closed', async () => {
			// GIVEN a settled conversation whose latest message came in
			// WHEN asking what needs a reply
			const names = await found({ waitingOn: 'us' })
			// THEN it is not on the list: a settled conversation waits for nobody
			expect(names).not.toContain('closed-inbound')
		})

		it('should leave out mail a check marked as junk', async () => {
			// GIVEN the latest message came in but was marked spam
			// WHEN asking what needs a reply
			const names = await found({ waitingOn: 'us' })
			// THEN nobody is waiting on an answer to junk
			expect(names).not.toContain('junk')
		})

		it('should not read a delivery notice as their reply', async () => {
			// GIVEN our send, then a failure notice from a mail server
			// WHEN asking what needs a reply
			const names = await found({ waitingOn: 'us' })
			// THEN the notice is not somebody writing to us
			expect(names).not.toContain('notice')
		})

		it('should count a conversation we wrote to last', async () => {
			// GIVEN a conversation whose latest message went out and arrived
			// WHEN asking what is awaiting their answer
			const names = await found({ waitingOn: 'them' })
			// THEN it is there
			expect(names).toContain('awaiting-them')
		})

		it('should leave out a send that bounced', async () => {
			// GIVEN our latest message was refused by their mail server
			// WHEN asking what is awaiting their answer
			const names = await found({ waitingOn: 'them' })
			// THEN it is waiting on us to find a working address, not on them
			expect(names).not.toContain('bounced')
		})

		it('should find nothing when paired with a settled stage', async () => {
			// GIVEN conversations that need a reply, all of them open
			// WHEN asking for closed ones that also need a reply
			const names = await found({ waitingOn: 'us', status: ['closed'] })
			// THEN nothing, because only an open conversation waits for anybody
			expect(names).toEqual([])
		})
	})

	describe('when asked for what has gone quiet', () => {
		it('should count by the date on the message, not the day it was stored', async () => {
			// GIVEN mail written 30 days ago and stored today
			// WHEN asking what has been quiet a fortnight
			const names = await found({ quietDays: 14 })
			// THEN the conversation counts as quiet
			expect(names).toContain('backfilled')
		})

		it('should leave out one that had a message this week', async () => {
			// GIVEN a conversation whose latest message is two days old
			// WHEN asking what has been quiet a fortnight
			const names = await found({ quietDays: 14 })
			// THEN it is not quiet
			expect(names).not.toContain('needs-reply')
		})

		it('should judge by the newest message somebody kept', async () => {
			// GIVEN a recent message deleted from the mailbox, over an older one
			// WHEN asking what has been quiet a week
			const names = await found({ quietDays: 7 })
			// THEN the older surviving message is what the conversation is judged by
			expect(names).toContain('deleted-latest')
		})
	})

	describe('when asked for a stretch of time', () => {
		it('should include a conversation on the opening bound and exclude it on the closing one', async () => {
			// GIVEN a conversation whose latest message is 40 days old
			const page = await search({ quietDays: 39 })
			const at = page.items.find(t => t.id === threads['quiet'])?.lastMessageAt
			const moment = DateTime.toDateUtc(at!).toISOString()
			// WHEN asking from that exact moment, and then up to it
			const fromIt = await found({ lastMessageAfter: moment })
			const upToIt = await found({ lastMessageBefore: moment })
			// THEN the opening bound takes it in and the closing one stops short
			expect(fromIt).toContain('quiet')
			expect(upToIt).not.toContain('quiet')
		})
	})

	describe('when asked about unread mail', () => {
		it('should tell the unread from the read', async () => {
			// GIVEN one conversation read just now and others never read
			// WHEN asking for unread, and then for read
			const unread = await found({ unread: true })
			const read = await found({ unread: false })
			// THEN each is on one list and not the other
			expect(unread).toContain('needs-reply')
			expect(unread).not.toContain('quiet')
			expect(read).toContain('quiet')
			expect(read).not.toContain('needs-reply')
		})
	})

	describe('when asked for an address or a domain', () => {
		it('should match one address wherever it stands on the message', async () => {
			// GIVEN a conversation addressed to buyer@other.test
			// WHEN asking for that address
			const names = await found({ participant: 'Buyer@Other.test' })
			// THEN it is found, whatever case it was asked in
			expect(names).toEqual(['awaiting-them'])
		})

		it('should match a whole domain but not one that merely ends the same way', async () => {
			// GIVEN mail from old@quiet.test
			// WHEN asking for the domain, and for a domain ending in it
			const exact = await found({ participant: '@quiet.test' })
			const longer = await found({ participant: '@not-quiet.test' })
			// THEN only the real domain matches
			expect(exact).toContain('quiet')
			expect(longer).toEqual([])
		})
	})

	describe('when the address asked for carries a wildcard', () => {
		it('should read it as a character rather than as anything', async () => {
			// GIVEN conversations with ordinary addresses on them
			// WHEN a domain is asked for that is all wildcard
			const names = await found({ participant: '@%' })
			// THEN nothing matches: the % is a percent sign, not "any domain"
			expect(names).toEqual([])
		})
	})

	describe('when asked about attachments', () => {
		it('should count a file somebody attached and not an inline image', async () => {
			// GIVEN one conversation with a PDF and one with only a logo in the body
			// WHEN asking for conversations carrying attachments
			const names = await found({ hasAttachments: true })
			// THEN only the PDF counts
			expect(names).toContain('with-file')
			expect(names).not.toContain('inline-only')
		})

		it('should turn the question round', async () => {
			// GIVEN the same two conversations
			// WHEN asking for conversations carrying none
			const names = await found({ hasAttachments: false })
			// THEN the inline-only one is among them and the PDF is not
			expect(names).toContain('inline-only')
			expect(names).not.toContain('with-file')
		})
	})

	describe('when asked whose companies they are', () => {
		it('should find the ones this person owns', async () => {
			// GIVEN a conversation with a company this person owns
			// WHEN asking for their leads
			const names = await found({ companyOwner: [asUser.userId] })
			// THEN only that conversation
			expect(names).toEqual(['needs-reply'])
		})

		it('should find companies nobody has taken, and not conversations without one', async () => {
			// GIVEN one conversation on an unowned company and many with no company
			// WHEN asking for what is going spare
			const names = await found({ companyOwner: ['none'] })
			// THEN only the one with a company nobody owns
			expect(names).toEqual(['awaiting-them'])
		})

		it('should widen when both are asked for', async () => {
			// GIVEN both kinds
			// WHEN asking for mine plus the unclaimed
			const names = await found({ companyOwner: ['none', asUser.userId] })
			// THEN both come back
			expect(names).toEqual(
				expect.arrayContaining(['needs-reply', 'awaiting-them']),
			)
		})
	})

	describe('when asked for several stages at once', () => {
		it('should match any of them, and treat an empty list as nobody asking', async () => {
			// GIVEN open and closed conversations
			// WHEN asking for both stages, and then for none
			const both = await found({ status: ['open', 'closed'] })
			const blank = await found({ status: [] })
			const all = await found({})
			// THEN a list widens, and an empty one filters nothing
			expect(both).toContain('closed-inbound')
			expect(blank.length).toBe(all.length)
		})
	})

	describe('when asked for one mailbox', () => {
		it('should read the mailbox its messages arrived in', async () => {
			// GIVEN a conversation whose message arrived in the second mailbox
			// WHEN asking for that mailbox
			const names = await found({ inboxId: otherInboxId })
			// THEN only that conversation
			expect(names).toEqual(['second-mailbox'])
		})
	})

	describe('when filters are combined', () => {
		it('should narrow one another', async () => {
			// GIVEN conversations awaiting their answer, one of them quiet
			// WHEN asking for both at once
			const names = await found({ waitingOn: 'them', quietDays: 14 })
			// THEN the recent one drops out
			expect(names).not.toContain('awaiting-them')
		})
	})

	describe('when the list is counted', () => {
		it('should report a total that agrees with the rows for every filter', async () => {
			// GIVEN filters that read values worked out per conversation
			for (const filters of [
				{ waitingOn: 'us' } as const,
				{ unread: true } as const,
				{ quietDays: 14 } as const,
				{ hasAttachments: true } as const,
				{ sort: 'latest_message' } as const,
			]) {
				// WHEN each is asked with an exact count
				const page = await search({ ...filters, count: 'exact' })
				// THEN the count matches what came back
				expect(page.total).toBe(page.items.length)
			}
		})
	})

	describe('when the order is chosen', () => {
		it('should read by latest message rather than by what happened last', async () => {
			// GIVEN a conversation stored today whose mail is 30 days old
			// WHEN reading by latest message
			const byMessage = await found({ sort: 'latest_message' })
			// THEN the old mail sits below conversations with newer messages
			const backfilled = byMessage.indexOf('backfilled')
			const needsReply = byMessage.indexOf('needs-reply')
			expect(needsReply).toBeLessThan(backfilled)
		})
	})
})
