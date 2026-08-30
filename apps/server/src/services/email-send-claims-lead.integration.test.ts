// Sending really does claim the lead — the wiring between EmailService and the
// claim, which the claim's own suite cannot see. All three outbound paths are
// exercised, because each hands the sender over differently: `send` and `reply`
// through their extras, `sendDraft` as an argument of its own.
//
// Prereq: `pnpm cli services up` and a migrated database.

// PgLive reads DATABASE_URL at layer-build time (no default). Set it so the
// suite runs without a loaded .env, matching the other integration tests.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { CurrentOrg, SessionContext } from '@batuda/controllers'

import { PgLive } from '../db/client.js'
import { EmailService } from './email.js'
import { makeOrgRuntime, scopedAsOrg } from './email-harness.js'

const ORG = 'send-claims-test-org'
// The sender is a real member below: the claim refuses to hand a lead to
// somebody the organisation does not list, so an invented id would make every
// case here fail for the wrong reason.
const SENDER = 'send-claims-user'
// Deliberately never created: the case below is about somebody the
// organisation does not list.
const STRANGER = 'send-claims-stranger'

// One harness, shared with the other EmailService suites — see
// `email-harness.ts` for why the SqlClient has to be the same one the org scope
// is entered on.
let sentCount = 0
const asOrg = {
	orgId: ORG,
	orgName: 'Send Claims Test',
	orgSlug: 'send-claims-test',
	userId: SENDER,
	// Numbered, so two sends in one test cannot collide on the unique index
	// over (organisation, message id).
	onSend: () => {
		sentCount += 1
		return `<send-claims-${sentCount}@taller.test>`
	},
	// This suite is about what a send leaves on the company's history, so the
	// entries have to be written rather than swallowed.
	recordsHistory: true,
} as const

// Built once for the file; disposed in afterAll.
const runtime = makeOrgRuntime(asOrg)

const run = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
) => runtime.runPromise(scopedAsOrg(asOrg, effect))

// Fixture writes that must not go through the organisation's own scope, so the
// suite can set up and read back regardless of what the rules under test allow.
const sqlOnly = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

const body = [
	{
		type: 'paragraph' as const,
		spans: [{ kind: 'text' as const, value: 'Getting in touch.' }],
	},
]

let inboxId = ''
let companyId = ''

beforeAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				INSERT INTO "organization" (id, name, slug, "createdAt")
				VALUES (${ORG}, ${asOrg.orgName}, ${asOrg.orgSlug}, now())
				ON CONFLICT (id) DO NOTHING`
			yield* sql`
				INSERT INTO "user" (id, name, email, "emailVerified")
				VALUES (${SENDER}, ${SENDER}, ${`${SENDER}@test.local`}, true)
				ON CONFLICT (id) DO NOTHING`
			yield* sql`
				INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
				VALUES (${`m-${SENDER}`}, ${ORG}, ${SENDER}, 'owner', now())
				ON CONFLICT (id) DO NOTHING`
			const placeholder = new Uint8Array([0])
			const inboxes = yield* sql<{ id: string }>`
				INSERT INTO inboxes (
					organization_id, email, owner_user_id, is_default, is_private,
					grant_status, imap_host, imap_port, imap_security,
					smtp_host, smtp_port, smtp_security, username,
					password_ciphertext, password_nonce, password_tag
				) VALUES (
					${ORG}, ${'sender@send-claims.test'}, ${SENDER}, true, false,
					'connected', 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls',
					${'sender@send-claims.test'},
					${placeholder}, ${placeholder}, ${placeholder}
				) RETURNING id`
			inboxId = inboxes[0]!.id
			const companies = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name, status)
				VALUES (${ORG}, 'send-claims-co', 'Send Claims Co', 'prospect')
				RETURNING id`
			companyId = companies[0]!.id
		}),
	)
}, 30_000)

afterAll(async () => {
	await runtime.dispose()
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM timeline_activity WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM interactions WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_messages WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_drafts WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM companies WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM member WHERE "organizationId" = ${ORG}`
			yield* sql`DELETE FROM "user" WHERE id = ${SENDER}`
			yield* sql`DELETE FROM "organization" WHERE id = ${ORG}`
		}),
	)
})

// Back to an untouched lead with an empty history, so each case starts from the
// same place whatever the one before it did.
beforeEach(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				UPDATE companies SET owner_id = NULL, status = 'prospect'
				WHERE id = ${companyId}`
			yield* sql`DELETE FROM timeline_activity WHERE company_id = ${companyId}`
		}),
	)
})

const company = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ ownerId: string | null; status: string }>`
				SELECT owner_id, status FROM companies WHERE id = ${companyId}`
			return rows[0]!
		}),
	)

const historyKinds = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ kind: string }>`
				SELECT kind FROM timeline_activity
				WHERE company_id = ${companyId} ORDER BY occurred_at ASC`
			return rows.map(r => r.kind)
		}),
	)

const sentEmailActor = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ actorUserId: string | null }>`
				SELECT actor_user_id FROM timeline_activity
				WHERE company_id = ${companyId} AND kind = 'email_sent'
				ORDER BY occurred_at DESC LIMIT 1`
			return rows[0]?.actorUserId ?? null
		}),
	)

const person = { userId: SENDER, isAgent: false, claimsLead: true } as const

const sendFresh = (actor: {
	readonly userId: string
	readonly isAgent: boolean
	readonly claimsLead: boolean
}) =>
	run(
		Effect.gen(function* () {
			const svc = yield* EmailService
			return yield* svc.send(
				inboxId,
				'client@example.com',
				'Getting in touch',
				body,
				companyId,
				undefined,
				{ actor, skipFooter: true },
			)
		}),
	)

describe('EmailService — sending claims the lead', () => {
	describe('when a person opens with a company nobody has taken', () => {
		it('should hand them the lead and move it out of prospect', async () => {
			// GIVEN an unowned company still at prospect
			// WHEN they send it an email through the service
			await sendFresh(person)
			// THEN the send claimed it and counted as reaching out
			const row = await company()
			expect(row.ownerId).toBe(SENDER)
			expect(row.status).toBe('contacted')
		})

		it('should tell the history the email came first', async () => {
			// GIVEN an unowned company still at prospect
			// WHEN they send it an email
			await sendFresh(person)
			// THEN all three entries are there, cause before effect
			expect(await historyKinds()).toEqual([
				'email_sent',
				'lead_assigned',
				'stage_changed',
			])
		})

		it('should attribute the sent email to them, not to nobody', async () => {
			// GIVEN an unowned company
			// WHEN they send it an email
			await sendFresh(person)
			// THEN the email entry names who sent it
			expect(await sentEmailActor()).toBe(SENDER)
		})
	})

	describe('when the send is a reply on a thread that already exists', () => {
		it('should claim the lead and name the sender, same as opening one', async () => {
			// GIVEN a thread this organisation already started, and a company
			// back to unowned so the reply is what claims it
			await sendFresh(person)
			const threadLinkId = await sqlOnly(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						UPDATE companies SET owner_id = NULL, status = 'prospect'
						WHERE id = ${companyId}`
					yield* sql`DELETE FROM timeline_activity WHERE company_id = ${companyId}`
					const rows = yield* sql<{ id: string }>`
						SELECT id FROM email_thread_links WHERE company_id = ${companyId}
						ORDER BY created_at ASC LIMIT 1`
					return rows[0]!.id
				}),
			)
			// WHEN the reply goes out
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.reply(threadLinkId, body, {
						actor: person,
						skipFooter: true,
					})
				}),
			)
			// THEN replying carries the sender the way sending does — the two
			// paths hand the sender over differently, so covering one says
			// nothing about the other
			const row = await company()
			expect(row.ownerId).toBe(SENDER)
			expect(row.status).toBe('contacted')
			expect(await sentEmailActor()).toBe(SENDER)
		})
	})

	describe('when the send is a draft written earlier', () => {
		it('should claim the lead and name the sender, same as sending directly', async () => {
			// GIVEN a draft written against this company
			// WHEN it is sent
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					const draft = yield* svc.createDraft(
						inboxId,
						{
							to: 'client@example.com',
							subject: 'Picking this back up',
							bodyJson: body,
						},
						{ companyId },
					)
					return yield* svc.sendDraft(inboxId, draft.draftId, person)
				}),
			)
			// THEN a draft sent later claims exactly as a direct send does. This
			// path takes the sender as an argument of its own rather than through
			// the extras the other two use, so it is the one a hardcoded "nobody"
			// would slip through unnoticed
			const row = await company()
			expect(row.ownerId).toBe(SENDER)
			expect(row.status).toBe('contacted')
			expect(await sentEmailActor()).toBe(SENDER)
		})
	})

	describe('when an agent sends on the organisation behalf', () => {
		it('should send but hand it no lead', async () => {
			// GIVEN an unowned company and an agent principal
			// WHEN the agent emails it
			await sendFresh({ userId: SENDER, isAgent: true, claimsLead: true })
			// THEN the email is recorded and attributed, but nothing was claimed:
			// an owner has to be somebody who can be asked about the account
			expect(await historyKinds()).toEqual(['email_sent'])
			const row = await company()
			expect(row.ownerId).toBeNull()
			expect(row.status).toBe('prospect')
		})
	})

	describe('when the sender no longer works here', () => {
		it('should send, move the stage, and hand them no lead', async () => {
			// GIVEN somebody the organisation does not list, whose session still
			// points at it
			// WHEN they email an untouched company
			await sendFresh({ userId: STRANGER, isAgent: false, claimsLead: true })
			// THEN the lead stays unclaimed — the owner column has nothing in the
			// database behind it, so this check is what refuses them — while the
			// stage still moves, because an email did go out
			const row = await company()
			expect(row.ownerId).toBeNull()
			expect(row.status).toBe('contacted')
			expect(await historyKinds()).toEqual(['email_sent', 'stage_changed'])
		})
	})
})
