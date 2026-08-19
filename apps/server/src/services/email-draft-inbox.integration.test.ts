// An assistant is asked to draft an email. Nobody tells it which mailbox — the
// person never mentions one — so naming no mailbox has to work, and has to
// land somewhere a person would expect. These tests pin where that is: the
// mailbox you send from by default when the draft is being written, and the
// mailbox the draft already sits in for everything after.

// PgLive reads DATABASE_URL at layer-build time (no default). Set it so the
// suite runs without a loaded .env, matching the other integration tests.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
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

const ORG = 'draft-inbox-test-org'
const ALICE = 'draft-inbox-alice'
const BOB = 'draft-inbox-bob'
const SENT_MESSAGE_ID = '<draft-inbox-test@taller.test>'

const ALICE_ADDRESS = 'alice-drafts@taller.test'
const TEAM_ADDRESS = 'team-drafts@taller.test'
const BOB_ADDRESS = 'bob-drafts@taller.test'

const stubCrypto = Layer.succeed(CredentialCrypto, {
	encryptPassword: () => ({
		ciphertext: new Uint8Array([0]),
		nonce: new Uint8Array([0]),
		tag: new Uint8Array([0]),
	}),
	decryptPassword: () => 'stubbed-password',
} as never)

// The address a message actually went out from is only visible at the wire, so
// the transport keeps the last one it was handed.
let lastSentFrom: string | null = null

const stubTransport = Layer.succeed(MailTransport, {
	probe: () => Effect.void,
	send: (_creds: unknown, message: { from: string }) =>
		Effect.sync(() => {
			lastSentFrom = message.from
			return { messageId: SENT_MESSAGE_ID, raw: new Uint8Array([0]) }
		}),
	appendToSent: () => Effect.void,
} as never)

const stubStorage = Layer.succeed(StorageProvider, {
	put: () => Effect.void,
} as never)

const stubStaging = Layer.succeed(EmailAttachmentStaging, {
	resolve: () => Effect.succeed([]),
	markSentAndCleanup: () => Effect.void,
	sweepForDraft: () => Effect.void,
} as never)

const stubTimeline = Layer.succeed(TimelineActivityService, {
	record: () => Effect.void,
} as never)

const serviceLayer = EmailService.layer.pipe(
	Layer.provide([
		stubCrypto,
		stubTransport,
		stubStorage,
		stubStaging,
		stubTimeline,
		Layer.succeed(EmailProvider, {} as never),
		DraftStore.layer.pipe(Layer.provide(PgLive)),
		Layer.succeed(CalendarService, {} as never),
	]),
	Layer.provide(PgLive),
)

const actingAs = (userId: string) =>
	Layer.mergeAll(
		Layer.succeed(CurrentOrg, {
			id: ORG,
			name: 'Draft Inbox Test',
			slug: 'draft-inbox-test',
			role: 'member',
		}),
		Layer.succeed(SessionContext, {
			userId,
			email: `${userId}@test.local`,
			name: undefined,
			isAgent: false,
		}),
	)

// Run the way a request does, inside the organization's own database scope.
const runAs = <A, E>(
	userId: string,
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: {
					id: ORG,
					name: 'Draft Inbox Test',
					slug: 'draft-inbox-test',
				} as never,
				userId,
				role: 'member',
			})(
				effect.pipe(
					Effect.provide(serviceLayer),
					Effect.provide(actingAs(userId)),
				),
			)
		}).pipe(Effect.provide(PgLive)),
	)

const sqlOnly = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

const placeholder = new Uint8Array([0])

let aliceInboxId = ''
let teamInboxId = ''
let bobInboxId = ''

const insertInbox = (args: {
	readonly email: string
	readonly ownerUserId: string | null
	readonly isDefault: boolean
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{ id: string }>`
			INSERT INTO inboxes (
				organization_id, email, owner_user_id, is_default, is_private,
				imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security, username,
				password_ciphertext, password_nonce, password_tag,
				grant_status, active
			) VALUES (
				${ORG}, ${args.email}, ${args.ownerUserId}, ${args.isDefault}, false,
				'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', ${args.email},
				${placeholder}, ${placeholder}, ${placeholder},
				'connected', true
			)
			RETURNING id
		`
		return rows[0]!.id
	})

const draftInboxOf = (draftId: string) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ inboxId: string }>`
				SELECT inbox_id FROM email_drafts WHERE draft_id = ${draftId}
			`
			return rows[0]?.inboxId ?? null
		}),
	)

const body = [
	{ type: 'paragraph', spans: [{ kind: 'text', value: 'Half written.' }] },
] as never

beforeAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			// Better Auth owns this table, so its columns are camelCase.
			yield* sql`
				INSERT INTO organization (id, name, slug, "createdAt")
				VALUES (${ORG}, 'Draft Inbox Test', 'draft-inbox-test', now())
				ON CONFLICT (id) DO NOTHING
			`
		}),
	)
})

beforeEach(async () => {
	lastSentFrom = null
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM email_messages WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_drafts WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
		}),
	)
	aliceInboxId = await sqlOnly(
		insertInbox({
			email: ALICE_ADDRESS,
			ownerUserId: ALICE,
			isDefault: true,
		}),
	)
	teamInboxId = await sqlOnly(
		insertInbox({ email: TEAM_ADDRESS, ownerUserId: null, isDefault: false }),
	)
	bobInboxId = await sqlOnly(
		insertInbox({ email: BOB_ADDRESS, ownerUserId: BOB, isDefault: true }),
	)
})

afterAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM email_messages WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_drafts WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM organization WHERE id = ${ORG}`
		}),
	)
})

const createDraft = (inboxId: string | undefined) =>
	runAs(
		ALICE,
		Effect.gen(function* () {
			const svc = yield* EmailService
			return yield* svc.createDraft(inboxId, {
				to: 'client@example.com',
				subject: 'Quote',
				bodyJson: body,
			})
		}),
	)

// The draft a create answered with, or a failed expectation naming the exit.
const draftOf = (exit: Exit.Exit<unknown, unknown>) => {
	expect(
		Exit.isSuccess(exit),
		`expected a draft, got ${JSON.stringify(exit)}`,
	).toBe(true)
	return (Exit.isSuccess(exit) ? exit.value : null) as {
		draftId: string
		inboxId: string
		subject?: string
	}
}

// What a failure was, as text, so a test can say which refusal it expects
// without reaching into the shape of a cause.
const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
	expect(
		Exit.isFailure(exit),
		`expected a refusal, got ${JSON.stringify(exit)}`,
	).toBe(true)
	return JSON.stringify(Exit.isFailure(exit) ? exit.cause : null)
}

describe('EmailService.createDraft', () => {
	describe('when no mailbox is named', () => {
		it('should write the draft in the mailbox the member sends from', async () => {
			// GIVEN Alice, whose own mailbox is the one she sends from, and a team
			// mailbox she can also reach
			// WHEN she starts a draft without saying which to use
			const exit = await createDraft(undefined)

			// THEN it is written in the one she sends from — the same mailbox a
			// plain send would have gone out from
			expect(draftOf(exit).inboxId).toBe(aliceInboxId)
		})

		it('should read a blank mailbox as naming none, the way a send does', async () => {
			// GIVEN a client that fills an optional field with an empty string
			// rather than leaving it out — which `send` has always read as "use
			// mine"
			// WHEN a draft is started that way
			const exit = await createDraft('   ')

			// THEN it lands in the mailbox she sends from, rather than looking for
			// a mailbox with a blank name and reporting it missing
			expect(draftOf(exit).inboxId).toBe(aliceInboxId)
		})

		it('should say so plainly when there is no such mailbox to fall back on', async () => {
			// GIVEN a member who has connected no mailbox at all
			await sqlOnly(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						UPDATE inboxes SET is_default = false WHERE id = ${aliceInboxId}
					`
				}),
			)

			// WHEN they start a draft without naming one
			const exit = await createDraft(undefined)

			// THEN nothing is written and the answer names what is missing, rather
			// than reporting a mailbox that could not be found
			expect(failureOf(exit)).toContain('NoDefaultInbox')
		})
	})

	describe('when a mailbox is named', () => {
		it('should write the draft there instead', async () => {
			// GIVEN the team mailbox, which is not the one Alice sends from
			// WHEN she names it
			const exit = await createDraft(teamInboxId)

			// THEN the draft is written there — naming one still decides
			expect(draftOf(exit).inboxId).toBe(teamInboxId)
		})

		it('should refuse a mailbox that is not the member’s to send through', async () => {
			// GIVEN Bob's own mailbox, which is not Alice's to act through
			// WHEN Alice names it
			const exit = await createDraft(bobInboxId)

			// THEN it reads as absent rather than refused, so this cannot be used
			// to find out whose mailboxes exist
			expect(failureOf(exit)).toContain('NotFound')
		})
	})
})

describe('EmailService.updateDraft', () => {
	describe('when no mailbox is named', () => {
		it('should change the draft in the mailbox it already lives in', async () => {
			// GIVEN a draft Alice started in the team mailbox, not the one she
			// sends from
			const draftId = draftOf(await createDraft(teamInboxId)).draftId

			// WHEN she changes it without naming a mailbox
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateDraft(undefined, draftId, {
						subject: 'Quote, revised',
					})
				}),
			)

			// THEN the change lands, and the draft stays where it was — the draft
			// says which mailbox it is in, so nothing has to be repeated back
			expect(draftOf(exit).subject).toBe('Quote, revised')
			expect(await draftInboxOf(draftId)).toBe(teamInboxId)
		})
	})
})

describe('EmailService.deleteDraft', () => {
	describe('when no mailbox is named', () => {
		it('should throw away the draft in the mailbox it already lives in', async () => {
			// GIVEN a draft in the team mailbox
			const draftId = draftOf(await createDraft(teamInboxId)).draftId

			// WHEN Alice throws it away without naming a mailbox
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.deleteDraft(undefined, draftId)
				}),
			)

			// THEN it is gone
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(await draftInboxOf(draftId)).toBeNull()
		})
	})
})

describe('EmailService.sendDraft', () => {
	describe('when no mailbox is named', () => {
		it('should send from the mailbox the draft was written in', async () => {
			// GIVEN a draft written in the team mailbox — a shared address, and not
			// the one Alice sends from
			const draftId = draftOf(await createDraft(teamInboxId)).draftId

			// WHEN it is sent without naming a mailbox
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.sendDraft(undefined, draftId)
				}),
			)

			// THEN it goes out from the shared address it was written under, not
			// from Alice's own — a message composed on behalf of the team must not
			// quietly arrive signed by one person
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(lastSentFrom).toBe(TEAM_ADDRESS)
		})
	})

	describe('when a mailbox is named', () => {
		it('should send from that one, so the sender can still be changed', async () => {
			// GIVEN a draft written in the team mailbox
			const draftId = draftOf(await createDraft(teamInboxId)).draftId

			// WHEN it is sent through Alice's own mailbox instead, the way the
			// composer's From picker does
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.sendDraft(aliceInboxId, draftId)
				}),
			)

			// THEN it goes out from the one that was named
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(lastSentFrom).toBe(ALICE_ADDRESS)
		})
	})

	describe('when the mailbox the draft lives in is no longer usable', () => {
		it('should say the mailbox is the problem, not the draft', async () => {
			// GIVEN a draft in the team mailbox, whose credentials have since
			// stopped working
			const draftId = draftOf(await createDraft(teamInboxId)).draftId
			await sqlOnly(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						UPDATE inboxes SET grant_status = 'auth_failed'
						WHERE id = ${teamInboxId}
					`
				}),
			)

			// WHEN it is sent without naming a mailbox, so the draft's own is the
			// one that has to be reachable
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.sendDraft(undefined, draftId)
				}),
			)

			// THEN the refusal names the mailbox. Telling the caller the draft is
			// missing would send them looking for a message that is sitting right
			// there, while the thing to fix is the connection
			const refusal = failureOf(exit)
			expect(refusal).toContain('GrantUnavailable')
			expect(refusal).not.toContain('EmailDraft')
			expect(lastSentFrom).toBeNull()
		})
	})
})

describe('reaching for a colleague’s half-written mail', () => {
	describe('when no mailbox is named at all', () => {
		it('should read as absent, exactly as it does when one is', async () => {
			// GIVEN a draft sitting in Bob's own mailbox
			const bobDraft = await runAs(
				BOB,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.createDraft(bobInboxId, { subject: 'Private' })
				}),
			)
			const draftId = draftOf(bobDraft).draftId

			// WHEN Alice asks for it naming no mailbox — the shape that used to be
			// impossible to ask, and so was never checked
			const reached = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.getDraft(undefined, draftId)
				}),
			)
			// AND when she asks about a draft that was never written
			const nothing = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.getDraft(undefined, 'draft_never_written')
				}),
			)

			// THEN both refuse the same way, and neither names the mailbox Bob's
			// draft really sits in
			expect(Exit.isFailure(reached)).toBe(true)
			expect(Exit.isFailure(nothing)).toBe(true)
			const reachedCause = JSON.stringify(
				Exit.isFailure(reached) ? reached.cause : null,
			)
			expect(reachedCause).toContain('EmailDraft')
			expect(reachedCause).not.toContain(bobInboxId)
		})
	})
})
