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
import { TimelineActivityService } from '@batuda/timeline'

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

const draftThreadLinkOf = (draftId: string) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ threadLinkId: string | null }>`
				SELECT thread_link_id FROM email_drafts WHERE draft_id = ${draftId}
			`
			return rows[0]?.threadLinkId ?? null
		}),
	)

// A conversation already under way, for a draft to be attached to.
let threadSeq = 0
const insertThreadLink = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			threadSeq += 1
			const rows = yield* sql<{ id: string }>`
				INSERT INTO email_thread_links (
					organization_id, external_thread_id, subject
				) VALUES (
					${ORG}, ${`<thread-${threadSeq}@taller.test>`}, 'your quote'
				)
				RETURNING id
			`
			return rows[0]!.id
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

// Leaves Alice with a mailbox of her own that she no longer sends from, which
// is the state every fallback below starts from.
const clearAliceDefault = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				UPDATE inboxes SET is_default = false WHERE id = ${aliceInboxId}
			`
		}),
	)

// Takes a mailbox out of use the way removing one does, so a test can reach
// the state of having none rather than merely none chosen.
const deactivate = (inboxId: string) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				UPDATE inboxes SET active = false, is_default = false
				WHERE id = ${inboxId}
			`
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
		clientId?: string
		mode: 'new' | 'reply'
		threadLinkId?: string
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

		it('should fall back to the mailbox the whole team shares', async () => {
			// GIVEN a member who owns no mailbox — the shape an organization is
			// in once everybody's mailbox belongs to the team — and one mailbox
			// the team shares
			await deactivate(aliceInboxId)

			// WHEN she starts a draft without naming one
			const exit = await createDraft(undefined)

			// THEN it is written in the shared one. Every member may already send
			// through a mailbox nobody owns, and one can never be made anybody's
			// default — so refusing here left an organization whose mailboxes are
			// all shared unable to write a draft at all, while naming the very
			// same mailbox by hand worked
			expect(draftOf(exit).inboxId).toBe(teamInboxId)
		})

		it('should prefer the shared mailbox carrying the member’s own address', async () => {
			// GIVEN a member who owns no mailbox, and two shared ones, of which
			// one is at her own address
			await deactivate(aliceInboxId)
			const hers = await sqlOnly(
				insertInbox({
					email: `${ALICE}@test.local`,
					ownerUserId: null,
					isDefault: false,
				}),
			)

			// WHEN she starts a draft without naming one
			const exit = await createDraft(undefined)

			// THEN the one at her address is chosen. Which mailbox a message goes
			// out from is not a thing to settle by row order — sending as a
			// colleague because their row sorted first is the failure this rule
			// exists to prevent
			expect(draftOf(exit).inboxId).toBe(hers)
		})

		it('should refuse to choose between shared mailboxes that are equally hers', async () => {
			// GIVEN a member with no mailbox of her own — the state an
			// organization is in once everybody's mailbox belongs to the team —
			// and two shared ones, with nothing to say which is hers
			await deactivate(aliceInboxId)
			await sqlOnly(
				insertInbox({
					email: 'second-team@taller.test',
					ownerUserId: null,
					isDefault: false,
				}),
			)

			// WHEN she starts a draft without naming one
			const exit = await createDraft(undefined)

			// THEN it is refused, and the refusal names them so the next call can
			// pass one — guessing would send mail from a mailbox nobody picked
			const failure = failureOf(exit)
			expect(failure).toContain('NoDefaultInbox')
			expect(failure).toContain('no_shared_default')
			expect(failure).toContain(teamInboxId)
		})

		it('should tell a member who owns one to say it is the one they send from', async () => {
			// GIVEN a member whose own mailbox is connected and working, but who
			// has never said it is the one she sends from, and no shared mailbox
			await clearAliceDefault()
			await deactivate(teamInboxId)

			// WHEN she starts a draft without naming one
			const exit = await createDraft(undefined)

			// THEN the refusal says she has one and has not chosen it, and names
			// it. Reporting this as nothing connected would send her off to make
			// a second copy of the mailbox she already has, and unlike a shared
			// mailbox her own can be made the one she sends from — which is why
			// the reason travels rather than a sentence, so each surface can name
			// the call that fits it
			const failure = failureOf(exit)
			expect(failure).toContain('NoDefaultInbox')
			expect(failure).toContain('no_default_chosen')
			expect(failure).toContain(aliceInboxId)
		})

		it('should say so plainly when there is no mailbox to fall back on', async () => {
			// GIVEN a member with no mailbox of her own and no shared one either
			await deactivate(aliceInboxId)
			await deactivate(teamInboxId)

			// WHEN they start a draft without naming one
			const exit = await createDraft(undefined)

			// THEN nothing is written, and the answer says to connect one, which
			// is the true remedy only when there really is none
			const failure = failureOf(exit)
			expect(failure).toContain('NoDefaultInbox')
			expect(failure).toContain('none_connected')
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

	describe('when the conversation it answers is settled afterwards', () => {
		it('should attach the draft to that conversation', async () => {
			// GIVEN a draft written before anybody knew which conversation it
			// answers, and a conversation to attach it to
			const draftId = draftOf(await createDraft(undefined)).draftId
			const threadLinkId = await insertThreadLink()

			// WHEN the conversation is named on an update
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateDraft(undefined, draftId, {
						mode: 'reply',
						threadLinkId,
					})
				}),
			)

			// THEN it is attached, and says so when read back. An update that
			// answers with a success and a fresh updatedAt while changing
			// nothing sends the message as a brand-new conversation, and the
			// only way to notice is to read the sent mail afterwards
			const draft = draftOf(exit)
			expect(draft.threadLinkId).toBe(threadLinkId)
			expect(draft.mode).toBe('reply')
			expect(await draftThreadLinkOf(draftId)).toBe(threadLinkId)
		})

		it('should say the same thing in the clientId the composer reads', async () => {
			// GIVEN the same draft, attached to a conversation
			const draftId = draftOf(await createDraft(undefined)).draftId
			const threadLinkId = await insertThreadLink()
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateDraft(undefined, draftId, {
						mode: 'reply',
						threadLinkId,
					})
				}),
			)

			// THEN the clientId string carries it too. It holds its own copy of
			// the same facts for the editor that re-opens a draft, and a draft
			// whose column names one conversation and whose clientId names
			// another leaves no way to tell which is true
			expect(draftOf(exit).clientId).toContain(`threadLinkId=${threadLinkId}`)
		})

		it('should let a subject already written be cleared', async () => {
			// GIVEN a draft that carries a subject of its own
			const draftId = draftOf(await createDraft(undefined)).draftId

			// WHEN it is cleared, which is what a draft turned into a reply needs
			// so the conversation's own subject is used
			const exit = await runAs(
				ALICE,
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateDraft(undefined, draftId, { subject: null })
				}),
			)

			// THEN it is gone. Leaving the key out means "unchanged", so without
			// an explicit null there was no way to take a subject back off
			expect(draftOf(exit).subject).toBeUndefined()
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
					return yield* svc.sendDraft(undefined, draftId, null)
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
					return yield* svc.sendDraft(aliceInboxId, draftId, null)
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
					return yield* svc.sendDraft(undefined, draftId, null)
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
