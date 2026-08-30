// PgLive reads DATABASE_URL at layer-build time (no default). Set it so the
// suite runs without a loaded .env, matching the other integration tests.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { CurrentOrg, SessionContext } from '@batuda/controllers'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'
import { CalendarService } from './calendar.js'
import { CredentialCrypto } from './credential-crypto.js'
import { EmailService } from './email.js'
import { EmailAttachmentStaging } from './email-attachment-staging.js'
import { DraftStore } from './email-draft-store.js'
import { EmailProvider } from './email-provider.js'
import { MailTransport } from './mail-transport.js'
import { StorageProvider } from './storage-provider.js'
import { TimelineActivityService } from './timeline-activity.js'

// Sending really does claim the lead — the wiring between EmailService.send and
// the claim, which the claim's own suite cannot see. Everything below the send
// is stubbed (no SMTP, no object storage); Postgres and the timeline service are
// real, because the rows they write are what is being checked.
//
// Prereq: `pnpm cli services up` and a seeded `taller` org.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const FIXTURE_SLUG = `send-claims-${randomUUID()}`

let pool: pg.Pool
let orgId: string
let orgSlug: string
let companyId: string
let inboxId: string
// Only the mailbox's own owner may send through it, so the fixture mailbox
// below is created owned by this id.
const sender = `send-claims-${randomUUID()}`

const stubCrypto = Layer.succeed(CredentialCrypto, {
	encryptPassword: () => ({
		ciphertext: new Uint8Array([0]),
		nonce: new Uint8Array([0]),
		tag: new Uint8Array([0]),
	}),
	decryptPassword: () => 'stubbed-password',
} as never)

// Accepts the message and hands back a Message-ID, the way a real SMTP server
// would. Nothing leaves the machine.
const stubTransport = Layer.succeed(MailTransport, {
	probe: () => Effect.void,
	send: () =>
		Effect.succeed({
			messageId: `<${randomUUID()}@send-claims.test>`,
			raw: Buffer.from('stub'),
		}),
	appendToSent: () => Effect.void,
} as never)

const stubStorage = Layer.succeed(StorageProvider, {
	put: () => Effect.void,
} as never)

const stubStaging = Layer.succeed(EmailAttachmentStaging, {
	resolve: () => Effect.succeed([]),
	markSentAndCleanup: () => Effect.void,
} as never)

const serviceLayer = EmailService.layer.pipe(
	Layer.provide([
		stubCrypto,
		stubTransport,
		stubStorage,
		stubStaging,
		Layer.succeed(EmailProvider, {} as never),
		Layer.succeed(CalendarService, {} as never),
		// Real: the history entries and the claim it triggers are the point.
		TimelineActivityService.layer.pipe(Layer.provide(PgLive)),
		DraftStore.layer.pipe(Layer.provide(PgLive)),
	]),
	Layer.provide(PgLive),
)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const org = await pool.query<{ id: string; slug: string }>(
		`SELECT id, slug FROM organization WHERE slug = 'taller' LIMIT 1`,
	)
	const row = org.rows[0]
	if (!row) {
		throw new Error(
			"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
		)
	}
	orgId = row.id
	orgSlug = row.slug
	// Its own mailbox rather than a seeded one: suites run side by side and
	// several of them flip grant_status on the seeded inboxes, so borrowing one
	// makes this pass on its own and fail once the others run alongside it.
	const placeholder = new Uint8Array([0])
	const inbox = await pool.query<{ id: string }>(
		`INSERT INTO inboxes (
			organization_id, email, owner_user_id, is_default, is_private,
			grant_status, imap_host, imap_port, imap_security,
			smtp_host, smtp_port, smtp_security, username,
			password_ciphertext, password_nonce, password_tag
		) VALUES (
			$1, $2, $3, false, false,
			'connected', 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', $2,
			$4, $4, $4
		) RETURNING id`,
		[orgId, `${FIXTURE_SLUG}@test.local`, sender, placeholder],
	)
	inboxId = inbox.rows[0]!.id
	const insertedCompany = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, $2, 'prospect') RETURNING id`,
		[orgId, FIXTURE_SLUG],
	)
	companyId = insertedCompany.rows[0]!.id
	// The sender has to really work here — the claim refuses a lead to somebody
	// the organisation does not list.
	await pool.query(
		`INSERT INTO "user" (id, name, email, "emailVerified")
		 VALUES ($1, $1, $2, true) ON CONFLICT (id) DO NOTHING`,
		[sender, `${sender}@test.local`],
	)
	await pool.query(
		`INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
		 VALUES ($1, $2, $3, 'member', now()) ON CONFLICT (id) DO NOTHING`,
		[`m-${FIXTURE_SLUG}`, orgId, sender],
	)
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM timeline_activity WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM interactions WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM email_messages WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM email_thread_links WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId])
	await pool.query(`DELETE FROM inboxes WHERE id = $1`, [inboxId])
	await pool.query(`DELETE FROM member WHERE id = $1`, [`m-${FIXTURE_SLUG}`])
	await pool.query(`DELETE FROM "user" WHERE id = $1`, [sender])
	await pool.end()
})

beforeEach(async () => {
	await pool.query(
		`UPDATE companies SET owner_id = NULL, status = 'prospect' WHERE id = $1`,
		[companyId],
	)
	await pool.query(`DELETE FROM timeline_activity WHERE company_id = $1`, [
		companyId,
	])
})

// Sends the way a request does: inside the organization's own database scope,
// as a member with a session — the same shape the HTTP route establishes.
const sendAs = (actor: {
	readonly userId: string
	readonly isAgent: boolean
	readonly claimsLead: boolean
}): Promise<unknown> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: { id: orgId, name: 'Taller', slug: orgSlug } as never,
				userId: actor.userId,
				role: 'member',
			})(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.send(
						inboxId,
						'someone@example.test',
						'Hello from the first-email check',
						[
							{
								type: 'paragraph' as const,
								spans: [{ kind: 'text' as const, value: 'Hello.' }],
							},
						],
						companyId,
						undefined,
						{ actor, skipFooter: true },
					)
				}).pipe(
					Effect.provide(serviceLayer),
					Effect.provideService(SessionContext, {
						userId: actor.userId,
						email: `${actor.userId}@test.local`,
						name: undefined,
						isAgent: actor.isAgent,
					}),
					Effect.provideService(CurrentOrg, {
						id: orgId,
						name: 'Taller',
						slug: orgSlug,
						role: 'member',
					}),
				),
			)
		}).pipe(Effect.provide(PgLive), Effect.orDie),
	)

// Replies on an existing thread, the same way a request does. The reply path
// hands `actor` over through a different argument than `send` does, so covering
// one says nothing about the other.
const replyAs = (
	threadLinkId: string,
	actor: {
		readonly userId: string
		readonly isAgent: boolean
		readonly claimsLead: boolean
	},
): Promise<unknown> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: { id: orgId, name: 'Taller', slug: orgSlug } as never,
				userId: actor.userId,
				role: 'member',
			})(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.reply(
						threadLinkId,
						[
							{
								type: 'paragraph' as const,
								spans: [{ kind: 'text' as const, value: 'Following up.' }],
							},
						],
						{ actor, skipFooter: true },
					)
				}).pipe(
					Effect.provide(serviceLayer),
					Effect.provideService(SessionContext, {
						userId: actor.userId,
						email: `${actor.userId}@test.local`,
						name: undefined,
						isAgent: actor.isAgent,
					}),
					Effect.provideService(CurrentOrg, {
						id: orgId,
						name: 'Taller',
						slug: orgSlug,
						role: 'member',
					}),
				),
			)
		}).pipe(Effect.provide(PgLive), Effect.orDie),
	)

const firstThreadLinkId = async (): Promise<string> => {
	const rows = await pool.query<{ id: string }>(
		`SELECT id FROM email_thread_links WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1`,
		[companyId],
	)
	return rows.rows[0]!.id
}

const company = async (): Promise<{
	owner_id: string | null
	status: string
}> => {
	const rows = await pool.query<{ owner_id: string | null; status: string }>(
		`SELECT owner_id, status FROM companies WHERE id = $1`,
		[companyId],
	)
	return rows.rows[0]!
}

const historyKinds = async (): Promise<ReadonlyArray<string>> => {
	const rows = await pool.query<{ kind: string }>(
		`SELECT kind FROM timeline_activity WHERE company_id = $1
		 ORDER BY occurred_at ASC`,
		[companyId],
	)
	return rows.rows.map(r => r.kind)
}

describe('EmailService.send', () => {
	describe('when a person emails a lead nobody has taken', () => {
		it('should hand them the lead and move it out of prospect', async () => {
			// GIVEN an unowned company still at prospect
			// WHEN Alice sends it an email through the service
			await sendAs({ userId: sender, isAgent: false, claimsLead: true })
			// THEN the send claimed it for her and counted as contact
			const row = await company()
			expect(row.owner_id).toBe(sender)
			expect(row.status).toBe('contacted')
		})

		it('should tell the history the email came first', async () => {
			// GIVEN an unowned company still at prospect
			// WHEN Alice sends it an email
			await sendAs({ userId: sender, isAgent: false, claimsLead: true })
			// THEN all three entries are there, cause before effect
			expect(await historyKinds()).toEqual([
				'email_sent',
				'lead_assigned',
				'stage_changed',
			])
		})

		it('should attribute the sent email to her, not to nobody', async () => {
			// GIVEN an unowned company
			// WHEN Alice sends it an email
			await sendAs({ userId: sender, isAgent: false, claimsLead: true })
			// THEN the email entry names who sent it
			const rows = await pool.query<{ actor_user_id: string | null }>(
				`SELECT actor_user_id FROM timeline_activity
				 WHERE company_id = $1 AND kind = 'email_sent'`,
				[companyId],
			)
			expect(rows.rows[0]?.actor_user_id).toBe(sender)
		})
	})

	describe('when the follow-up is a reply on an existing thread', () => {
		it('should claim the lead and name the sender, same as a first send', async () => {
			// GIVEN a thread this org already started, on a company nobody owns —
			// the first send is only here to leave a thread behind, so what it
			// claimed goes back the way it was before the reply
			await sendAs({ userId: sender, isAgent: false, claimsLead: true })
			await pool.query(
				`UPDATE companies SET owner_id = NULL, status = 'prospect' WHERE id = $1`,
				[companyId],
			)
			await pool.query(`DELETE FROM timeline_activity WHERE company_id = $1`, [
				companyId,
			])
			// WHEN the reply goes out
			await replyAs(await firstThreadLinkId(), {
				userId: sender,
				isAgent: false,
				claimsLead: true,
			})
			// THEN replying carries the sender the same way sending does
			const row = await company()
			expect(row.owner_id).toBe(sender)
			expect(row.status).toBe('contacted')
			const attributed = await pool.query<{ actor_user_id: string | null }>(
				`SELECT actor_user_id FROM timeline_activity
				 WHERE company_id = $1 AND kind = 'email_sent'`,
				[companyId],
			)
			expect(attributed.rows[0]?.actor_user_id).toBe(sender)
		})
	})

	describe("when an agent sends on the org's behalf", () => {
		it('should send but hand it no lead', async () => {
			// GIVEN an unowned company and an agent, sending under the mailbox
			// owner's id because that is the only id the mailbox lets through
			// WHEN the agent emails it
			await sendAs({ userId: sender, isAgent: true, claimsLead: true })
			// THEN the email is recorded and attributed, but nothing was claimed:
			// an owner has to be somebody who can be asked about the account
			expect(await historyKinds()).toEqual(['email_sent'])
			const row = await company()
			expect(row.owner_id).toBeNull()
			expect(row.status).toBe('prospect')
		})
	})
})
