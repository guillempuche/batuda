// Narrowing the list of stored messages, one message at a time.
//
// This is the list somebody reads to audit what was sent and how it fared, so
// the filters that matter most are the ones about the words a mail server used:
// a refusal that was final against one that was temporary, a message that went
// out against one that came in. Those words are a closed list, and a filter
// asking for one that does not exist has to be refused rather than answered
// with an empty page — which is checked where the words are read, at the tools
// and the web API; what is checked here is that each word finds what it should.
//
// The rest earns a live database for two reasons: a date bound is compared by
// the database and not by us, and mail in somebody's private mailbox has to
// stay out of both the rows and the count beside them.
//
// Prereq: `pnpm cli services up` and `pnpm cli db migrate`.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EmailService } from './email.js'
import { makeOrgRuntime, scopedAsOrg } from './email-harness.js'
import type { MessageFilters } from './email-list-filters.js'

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG_ID = `message-filters-${randomUUID().slice(0, 8)}`
const OWNER = 'message-filters-owner'
const COLLEAGUE = 'message-filters-colleague'

const asOwner = {
	orgId: ORG_ID,
	orgName: 'Message Filters Test',
	orgSlug: 'message-filters-test',
	userId: OWNER,
} as const
const asColleague = { ...asOwner, userId: COLLEAGUE } as const

const ownerRuntime = makeOrgRuntime(asOwner)
const colleagueRuntime = makeOrgRuntime(asColleague)

let pool: pg.Pool
let inboxId: string
let secondInboxId: string
let privateInboxId: string
let companyId: string

/** Every message this suite stores, by the name the tests call it. */
const messages: Record<string, string> = {}

const list = (
	runtime: typeof ownerRuntime,
	who: { readonly orgId: string; readonly userId: string },
	filters: MessageFilters & {
		count?: 'exact' | 'none'
		limit?: number
		offset?: number
	},
) =>
	runtime.runPromise(
		scopedAsOrg(
			{ ...asOwner, ...who },
			Effect.gen(function* () {
				const emails = yield* EmailService
				return yield* emails.listMessages(filters)
			}),
		),
	)

/** The messages a filter found, by their test names. */
const found = async (
	filters: MessageFilters & {
		count?: 'exact' | 'none'
		limit?: number
		offset?: number
	},
): Promise<string[]> => {
	const page = await list(ownerRuntime, asOwner, filters)
	const byId = new Map(Object.entries(messages).map(([name, id]) => [id, name]))
	return page.items.map(m => byId.get(m.id) ?? m.id).sort()
}

const insertInbox = async (email: string, isPrivate = false) => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, is_private,
		  imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security,
		  username, password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, $2, $3, $4, 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', $3,
		         '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG_ID, OWNER, email, isPrivate],
	)
	return rows.rows[0]!.id
}

const seedMessage = async (args: {
	readonly name: string
	readonly direction?: 'inbound' | 'outbound'
	readonly status?: string
	readonly bounceType?: string | null
	readonly receivedAt?: string | null
	readonly body?: string
	readonly from?: string
	readonly inboxId?: string
	readonly companyId?: string | null
}) => {
	const messageId = `<${args.name}-${ORG_ID}@messages.test>`
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO email_messages
		 (organization_id, inbox_id, message_id, thread_key, direction, folder,
		  raw_rfc822_ref, subject, received_at, text_preview, text_body, status,
		  bounce_type, company_id)
		 VALUES ($1, $2, $3, $3, $4, 'INBOX', 'message-filters', $5, $6, $7, $7, $8, $9, $10)
		 RETURNING id`,
		[
			ORG_ID,
			args.inboxId ?? inboxId,
			messageId,
			args.direction ?? 'inbound',
			args.name,
			// Spelled out rather than defaulted with `??`, so a fixture can say
			// "no date at all" — which is a case the range filter has to handle.
			'receivedAt' in args ? args.receivedAt : '2026-09-10T09:00:00Z',
			args.body ?? 'an ordinary message',
			args.status ?? 'normal',
			args.bounceType ?? null,
			args.companyId ?? null,
		],
	)
	const id = rows.rows[0]!.id
	messages[args.name] = id
	await pool.query(
		`INSERT INTO message_participants (email_message_id, email_address, role)
		 VALUES ($1, $2, 'from')`,
		[id, args.from ?? 'someone@client.test'],
	)
	return id
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	inboxId = await insertInbox(`team-${ORG_ID}@messages.test`)
	secondInboxId = await insertInbox(`second-${ORG_ID}@messages.test`)
	privateInboxId = await insertInbox(`mine-${ORG_ID}@messages.test`, true)
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, 'Message Filters Co', 'prospect') RETURNING id`,
		[ORG_ID, `message-filters-${ORG_ID}`],
	)
	companyId = company.rows[0]!.id

	await seedMessage({
		name: 'ordinary-in',
		body: 'the roof quote you asked for',
	})
	await seedMessage({
		name: 'ordinary-out',
		direction: 'outbound',
		companyId,
		from: `team-${ORG_ID}@messages.test`,
		body: 'here is the invoice',
	})
	await seedMessage({
		name: 'hard-bounce',
		direction: 'outbound',
		status: 'bounced',
		bounceType: 'hard',
		receivedAt: '2026-09-11T09:00:00Z',
	})
	await seedMessage({
		name: 'soft-bounce',
		direction: 'outbound',
		status: 'bounced',
		bounceType: 'soft',
		receivedAt: '2026-09-12T09:00:00Z',
	})
	// A mail server that said neither "never" nor "not now".
	await seedMessage({
		name: 'bounce-without-a-type',
		direction: 'outbound',
		status: 'bounced',
		bounceType: null,
	})
	await seedMessage({ name: 'in-the-second-mailbox', inboxId: secondInboxId })
	await seedMessage({
		name: 'from-a-known-domain',
		from: 'marta@ferrosbl.test',
		receivedAt: '2026-09-13T09:00:00Z',
	})
	// Mail with no date of its own: a sender that left the header off.
	await seedMessage({ name: 'undated', receivedAt: null })
	await seedMessage({
		name: 'private',
		inboxId: privateInboxId,
		body: 'a private arrangement',
		from: 'lawyer@confidential.test',
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
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG_ID])
	await pool.query(`DELETE FROM inboxes WHERE organization_id = $1`, [ORG_ID])
	await pool.end()
	await ownerRuntime.dispose()
	await colleagueRuntime.dispose()
})

describe('EmailService.listMessages filters [email-list-filters.ts]', () => {
	describe('when asked for what became of a message', () => {
		it('should match any of the words asked for', async () => {
			// GIVEN ordinary messages and refused ones
			// WHEN both words are asked for
			const both = await found({ status: ['normal', 'bounced'] })
			// THEN messages of either kind come back
			expect(both).toContain('ordinary-in')
			expect(both).toContain('hard-bounce')
		})

		it('should narrow to one word on its own', async () => {
			// GIVEN the same messages
			// WHEN only refusals are asked for
			const bounced = await found({ status: ['bounced'] })
			// THEN nothing ordinary is on the list
			expect(bounced).not.toContain('ordinary-in')
			expect(bounced).toContain('soft-bounce')
		})

		it('should treat an empty list as nobody asking', async () => {
			// GIVEN a filter somebody cleared
			// WHEN it is sent as an empty list
			const asked = await found({ status: [] })
			const all = await found({})
			// THEN it narrows nothing
			expect(asked.length).toBe(all.length)
		})
	})

	describe('when asked which way a message went', () => {
		it('should separate what came in from what went out', async () => {
			// GIVEN messages both ways
			// WHEN each direction is asked for
			const incoming = await found({ direction: 'inbound' })
			const outgoing = await found({ direction: 'outbound' })
			// THEN neither list holds the other's
			expect(incoming).toContain('ordinary-in')
			expect(incoming).not.toContain('ordinary-out')
			expect(outgoing).toContain('ordinary-out')
			expect(outgoing).not.toContain('ordinary-in')
		})
	})

	describe('when asked how final a refusal was', () => {
		it('should tell a permanent one from a temporary one', async () => {
			// GIVEN one refusal of each kind
			// WHEN each is asked for
			// THEN each finds only its own
			expect(await found({ bounceType: 'hard' })).toEqual(['hard-bounce'])
			expect(await found({ bounceType: 'soft' })).toEqual(['soft-bounce'])
		})

		it('should leave out a refusal that said neither', async () => {
			// GIVEN a refusal with no type recorded
			// WHEN either kind is asked for
			const hard = await found({ bounceType: 'hard' })
			const soft = await found({ bounceType: 'soft' })
			// THEN it is on neither list: nothing is known about how final it was
			expect(hard).not.toContain('bounce-without-a-type')
			expect(soft).not.toContain('bounce-without-a-type')
		})
	})

	describe('when asked for one mailbox', () => {
		it('should read the mailbox the message is stored under', async () => {
			// GIVEN a message in a second mailbox
			// WHEN that mailbox is asked for
			const second = await found({ inboxId: secondInboxId })
			// THEN only its own message comes back
			expect(second).toEqual(['in-the-second-mailbox'])
		})
	})

	describe('when asked for a stretch of time', () => {
		it('should take in the opening moment and stop before the closing one', async () => {
			// GIVEN messages dated the 11th, 12th and 13th
			// WHEN the 11th to the 13th is asked for
			const between = await found({
				receivedAfter: '2026-09-11T09:00:00Z',
				receivedBefore: '2026-09-13T09:00:00Z',
			})
			// THEN the opening moment is in and the closing one is not
			expect(between).toContain('hard-bounce')
			expect(between).toContain('soft-bounce')
			expect(between).not.toContain('from-a-known-domain')
		})

		it('should leave out mail with no date of its own', async () => {
			// GIVEN a message whose sender left the date off
			// WHEN any stretch of time is asked for
			const dated = await found({ receivedAfter: '2000-01-01' })
			// THEN it is not in it: there is nothing to compare
			expect(dated).not.toContain('undated')
		})

		it('should read a day as that day beginning', async () => {
			// GIVEN a message dated the 13th at nine in the morning
			// WHEN everything from the 13th is asked for
			const from13th = await found({ receivedAfter: '2026-09-13' })
			// THEN it is included, because the day starts before it
			expect(from13th).toContain('from-a-known-domain')
		})
	})

	describe('when asked for an address or a domain', () => {
		it('should match the address whatever case it was typed in', async () => {
			// GIVEN a message from marta@ferrosbl.test
			// WHEN her address is asked for in capitals
			const mine = await found({ participant: 'MARTA@ferrosbl.test' })
			// THEN it is found
			expect(mine).toEqual(['from-a-known-domain'])
		})

		it('should match a whole domain, and not one that merely ends the same way', async () => {
			// GIVEN the same message
			// WHEN the domain is asked for, and then a longer one ending in it
			const exact = await found({ participant: '@ferrosbl.test' })
			const longer = await found({ participant: '@not-ferrosbl.test' })
			// THEN only the real domain matches
			expect(exact).toEqual(['from-a-known-domain'])
			expect(longer).toEqual([])
		})
	})

	describe('when asked for words', () => {
		it('should search what the message says', async () => {
			// GIVEN a message about a roof quote
			// WHEN that word is searched for
			const hits = await found({ query: 'roof' })
			// THEN the message comes back
			expect(hits).toContain('ordinary-in')
		})

		it('should search the addresses on it too', async () => {
			// GIVEN a message from a known domain
			// WHEN the address is searched for
			const hits = await found({ query: 'marta@ferrosbl.test' })
			// THEN it is found the same way
			expect(hits).toContain('from-a-known-domain')
		})

		it('should treat a blank search as nobody asking', async () => {
			// GIVEN spaces typed into the box
			// WHEN they are searched for
			const hits = await found({ query: '   ' })
			const all = await found({})
			// THEN nothing is narrowed
			expect(hits.length).toBe(all.length)
		})
	})

	describe('when filters are combined', () => {
		it('should narrow one another', async () => {
			// GIVEN one outgoing message to a company
			// WHEN the company and the direction are asked for together
			const both = await found({ companyId, direction: 'outbound' })
			// THEN only what meets both
			expect(both).toEqual(['ordinary-out'])
		})
	})

	describe('when the mail is in somebody else private mailbox', () => {
		it('should leave it out of a colleague list and out of the count', async () => {
			// GIVEN a message in a mailbox its owner keeps to themselves
			// WHEN a colleague lists messages, counted
			const page = await list(colleagueRuntime, asColleague, {
				count: 'exact',
			})
			const ids = page.items.map(m => m.id)
			// THEN it is in neither the rows nor the total beside them
			expect(ids).not.toContain(messages['private'])
			expect(page.total).toBe(ids.length)
		})

		it('should keep it out of the count even past the last page', async () => {
			// GIVEN a colleague asking for a page beyond what they may read,
			// which is where the count is worked out separately from the rows
			const page = await list(colleagueRuntime, asColleague, {
				count: 'exact',
				offset: 500,
			})
			// THEN nothing comes back, and the count still leaves the private
			// message out
			const everything = await list(colleagueRuntime, asColleague, {
				count: 'exact',
			})
			expect(page.items).toEqual([])
			expect(page.total).toBe(everything.total)
		})

		it('should show it to the person whose mailbox it is', async () => {
			// GIVEN the same message
			// WHEN its owner lists messages
			const mine = await found({})
			// THEN they see it
			expect(mine).toContain('private')
		})
	})

	describe('when the list is paged', () => {
		it('should say whether there is more to read', async () => {
			// GIVEN more messages than a page holds
			// WHEN a page of two is asked for
			const page = await list(ownerRuntime, asOwner, { limit: 2 })
			// THEN two come back and the answer says there are more
			expect(page.items).toHaveLength(2)
			expect(page.hasMore).toBe(true)
		})

		it('should stop saying so on the last page', async () => {
			// GIVEN a filter that matches exactly one message
			// WHEN a page of one is asked for
			const page = await list(ownerRuntime, asOwner, {
				bounceType: 'hard',
				limit: 1,
			})
			// THEN there is nothing after it
			expect(page.hasMore).toBe(false)
		})
	})
})
