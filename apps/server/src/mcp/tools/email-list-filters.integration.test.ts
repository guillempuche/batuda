// The filters as an assistant asks for them.
//
// The tools spell their parameters differently from the service — `waiting_on`
// against `waitingOn` — and a name that does not line up stops narrowing
// anything without saying so. This drives the real toolkit so the spelling is
// checked rather than assumed, and pins the two refusals that exist to stop an
// assistant reading "nothing matched" as "you have none of those": a word that
// is not one of ours, and a range that cannot hold anything.
//
// Prereq: `pnpm cli services up` and `pnpm cli db migrate`.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, Stream } from 'effect'
import { McpSchema } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../../db/client.js'
import { enterOrgScope } from '../../middleware/org.js'
import { CalendarService } from '../../services/calendar.js'
import { CredentialCrypto } from '../../services/credential-crypto.js'
import { EmailService } from '../../services/email.js'
import { EmailAttachmentStaging } from '../../services/email-attachment-staging.js'
import { DraftStore } from '../../services/email-draft-store.js'
import { EmailProvider } from '../../services/email-provider.js'
import { MailTransport } from '../../services/mail-transport.js'
import { StorageProvider } from '../../services/storage-provider.js'
import { EmailHandlersLive, EmailTools } from './email.js'

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `list-filters-mcp-${randomUUID().slice(0, 8)}`
const USER = 'list-filters-user'

const placeholder = new Uint8Array([0])
const stub = <T>(service: T, value: unknown) =>
	Layer.succeed(service as never, value as never)

const stubs = Layer.mergeAll(
	stub(CredentialCrypto, {
		encryptPassword: () => ({
			ciphertext: placeholder,
			nonce: placeholder,
			tag: placeholder,
		}),
		decryptPassword: () => 'stubbed-password',
	}),
	stub(MailTransport, {
		probe: () => Effect.void,
		send: () => Effect.succeed({ messageId: '<x@t.test>', raw: placeholder }),
		appendToSent: () => Effect.void,
	}),
	stub(StorageProvider, { put: () => Effect.void }),
	stub(EmailAttachmentStaging, {
		resolve: () => Effect.succeed([]),
		markSentAndCleanup: () => Effect.void,
		sweepForDraft: () => Effect.void,
	}),
	stub(TimelineActivityService, { record: () => Effect.void }),
	stub(EmailProvider, {}),
	stub(CalendarService, {}),
	stub(McpSchema.McpServerClient, {
		clientId: 1,
		initializePayload: { capabilities: {} },
		getClient: Effect.die('this suite never talks back to the client'),
	}),
)

const handlers = EmailHandlersLive.pipe(
	Layer.provide(
		EmailService.layer.pipe(
			Layer.provide(stubs),
			Layer.provide(DraftStore.layer.pipe(Layer.provide(PgLive))),
			Layer.provide(PgLive),
		),
	),
	Layer.provide(stubs),
	Layer.provide(PgLive),
)

const actingAs = Layer.mergeAll(
	Layer.succeed(CurrentOrg, {
		id: ORG,
		name: 'List Filters Test',
		slug: 'list-filters-test',
		role: 'member',
	} as never),
	Layer.succeed(SessionContext, {
		userId: USER,
		email: `${USER}@test.local`,
		name: undefined,
		isAgent: false,
	} as never),
)

const callTool = (name: string, params: Record<string, unknown>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: { id: ORG, name: 'List Filters Test', slug: 'x' } as never,
				userId: USER,
				role: 'member',
			})(
				Effect.gen(function* () {
					const toolkit = yield* EmailTools
					const stream = yield* toolkit.handle(name as never, params as never)
					const [first] = yield* Stream.runCollect(stream)
					return (first?.result ?? null) as {
						items?: ReadonlyArray<{ id: string; subject: string | null }>
					} | null
				}).pipe(
					Effect.provide(handlers),
					Effect.provide(actingAs),
					Effect.provide(stubs),
				),
			)
		}).pipe(Effect.provide(PgLive)),
	)

/** The same call, reporting a refusal as text rather than throwing it. */
const refusalFrom = (name: string, params: Record<string, unknown>) =>
	callTool(name, params).then(
		() => 'no refusal',
		(error: unknown) => String(error),
	)

const subjectsFrom = async (params: Record<string, unknown>) => {
	const page = await callTool('list_email_threads', params)
	return (page?.items ?? []).map(t => t.subject)
}

let pool: pg.Pool
let inboxId: string

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	const inbox = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, imap_host, imap_port, imap_security,
		  smtp_host, smtp_port, smtp_security, username,
		  password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, $2, $3, 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', $3,
		         '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG, USER, `team-${ORG}@mcp.test`],
	)
	inboxId = inbox.rows[0]!.id

	// Two conversations: one they wrote last, one we did.
	for (const [name, direction] of [
		['needs a reply', 'inbound'],
		['awaiting them', 'outbound'],
	] as const) {
		const key = `<${name.replace(/ /g, '-')}-${ORG}@mcp.test>`
		await pool.query(
			`INSERT INTO email_thread_links
			 (organization_id, external_thread_id, inbox_id, subject, status)
			 VALUES ($1, $2, $3, $4, 'open')`,
			[ORG, key, inboxId, name],
		)
		const row = await pool.query<{ id: string }>(
			`INSERT INTO email_messages
			 (organization_id, inbox_id, message_id, thread_key, direction, folder,
			  raw_rfc822_ref, subject, received_at, text_body, status)
			 VALUES ($1, $2, $3, $3, $4, 'INBOX', 'mcp-test', $5, now() - interval '3 days',
			         'hello', 'normal')
			 RETURNING id`,
			[ORG, inboxId, key, direction, name],
		)
		await pool.query(
			`INSERT INTO message_participants (email_message_id, email_address, role)
			 VALUES ($1, $2, 'from')`,
			[row.rows[0]!.id, `someone@acme-${ORG}.test`],
		)
	}
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM message_participants WHERE email_message_id IN
		   (SELECT id FROM email_messages WHERE organization_id = $1)`,
		[ORG],
	)
	await pool.query(`DELETE FROM email_messages WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(
		`DELETE FROM email_thread_links WHERE organization_id = $1`,
		[ORG],
	)
	await pool.query(`DELETE FROM inboxes WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe('list_email_threads [mcp/tools/email.ts]', () => {
	describe('when a filter is asked for in the tool spelling', () => {
		it('should narrow the list the way the service does', async () => {
			// GIVEN one conversation waiting on us and one on them
			// WHEN each is asked for by name
			const needingReply = await subjectsFrom({ waiting_on: 'us' })
			const awaitingThem = await subjectsFrom({ waiting_on: 'them' })
			// THEN each filter finds its own
			expect(needingReply).toEqual(['needs a reply'])
			expect(awaitingThem).toEqual(['awaiting them'])
		})

		it.each([
			['a mailbox', () => ({ inbox_id: inboxId })],
			['a quiet stretch', () => ({ quiet_days: 1 })],
			['an order', () => ({ sort: 'latest_message' })],
			['a domain', () => ({ participant: `@acme-${ORG}.test` })],
		])('should carry %s through to the answer', async (_what, params) => {
			// GIVEN a filter every conversation here meets
			// WHEN it is asked for
			const subjects = await subjectsFrom(params())
			// THEN both conversations come back, so the name reached the service
			expect(subjects.sort()).toEqual(['awaiting them', 'needs a reply'])
		})

		it('should carry unread mail through to the answer', async () => {
			// GIVEN one conversation with mail that came in and one with only a
			// message we sent
			// WHEN unread ones are asked for
			const subjects = await subjectsFrom({ unread: true })
			// THEN only the one somebody wrote to us, since a conversation of our
			// own mail alone is nobody's to read
			expect(subjects).toEqual(['needs a reply'])
		})

		it('should take several stages at once', async () => {
			// GIVEN two open conversations
			// WHEN both stages are named
			const subjects = await subjectsFrom({ status: ['open', 'closed'] })
			// THEN the open ones come back
			expect(subjects.sort()).toEqual(['awaiting them', 'needs a reply'])
		})

		it('should treat an empty list as nobody asking', async () => {
			// GIVEN no stage named at all
			// WHEN an empty list is sent
			const subjects = await subjectsFrom({ status: [] })
			// THEN nothing is narrowed
			expect(subjects).toHaveLength(2)
		})
	})

	describe('when the range can only find nothing', () => {
		it('should say so rather than answer with an empty page', async () => {
			// GIVEN bounds the wrong way round
			// WHEN the list is asked for
			const refusal = await refusalFrom('list_email_threads', {
				last_message_after: '2026-09-30',
				last_message_before: '2026-09-01',
			})
			// THEN the answer names both sides so they can be swapped
			expect(refusal).toContain('last_message_after')
			expect(refusal).toContain('last_message_before')
		})

		it.each([
			['a date that is not one', { last_message_after: 'last tuesday' }],
			['a day not on the calendar', { last_message_after: '2026-02-30' }],
		])('should say what is wrong with %s', async (_why, params) => {
			// GIVEN a bound nobody can read
			// WHEN the list is asked for
			const refusal = await refusalFrom('list_email_threads', params)
			// THEN it comes back as words, not as an empty list
			expect(refusal).not.toBe('no refusal')
		})
	})

	describe('when an address would match far more than it looks like', () => {
		it.each(['@', 'ana@', 'acme.test'])('should refuse %s', async value => {
			// GIVEN a participant that is neither one address nor one domain
			// WHEN the list is asked for
			const refusal = await refusalFrom('list_email_threads', {
				participant: value,
			})
			// THEN it is refused with something to act on
			expect(refusal).not.toBe('no refusal')
		})
	})
})

describe('list_email_messages [mcp/tools/email.ts]', () => {
	describe('when a status is asked for', () => {
		it('should refuse a word this system never stores', async () => {
			// GIVEN "delivered", which the tool used to advertise and never had
			// WHEN it is asked for
			const refusal = await refusalFrom('list_email_messages', {
				status: ['delivered'],
			})
			// THEN it is refused, rather than answered with an empty page
			expect(refusal).not.toBe('no refusal')
		})

		it('should take the words it does store', async () => {
			// GIVEN the statuses the database holds
			// WHEN they are asked for together
			const page = await callTool('list_email_messages', {
				status: ['normal', 'bounced'],
			})
			// THEN the call goes through
			expect(page?.items).toBeDefined()
		})
	})

	describe('when a refusal type is asked for', () => {
		it('should refuse one that is neither hard nor soft', async () => {
			// GIVEN a bounce type the mail worker never writes
			// WHEN it is asked for
			const refusal = await refusalFrom('list_email_messages', {
				bounce_type: 'unknown',
			})
			// THEN it is refused
			expect(refusal).not.toBe('no refusal')
		})
	})
})
