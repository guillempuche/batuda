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

// Who may reach whose mailbox. Real Postgres so the database rules that back
// these decisions (one default per person, a team mailbox owned by nobody)
// take part rather than being assumed.

const ORG = 'inbox-authz-test-org'
const ALICE = 'inbox-authz-alice'
const BOB = 'inbox-authz-bob'

const stubCrypto = Layer.succeed(CredentialCrypto, {
	encryptPassword: () => ({
		ciphertext: new Uint8Array([0]),
		nonce: new Uint8Array([0]),
		tag: new Uint8Array([0]),
	}),
	decryptPassword: () => 'stubbed-password',
} as never)

const stubTransport = Layer.succeed(MailTransport, {
	probe: () => Effect.void,
	send: () => Effect.die('send not used in this test'),
	appendToSent: () => Effect.die('appendToSent not used in this test'),
} as never)

const serviceLayer = EmailService.layer.pipe(
	Layer.provide([
		stubCrypto,
		stubTransport,
		Layer.succeed(EmailProvider, {} as never),
		Layer.succeed(TimelineActivityService, {} as never),
		Layer.succeed(EmailAttachmentStaging, {} as never),
		// Real, not stubbed: half-written mail is reached through it, and the
		// rules about who may are the point of this suite.
		DraftStore.layer.pipe(Layer.provide(PgLive)),
		Layer.succeed(CalendarService, {} as never),
		Layer.succeed(StorageProvider, {} as never),
	]),
	Layer.provide(PgLive),
)

// The caller: who they are, and what they may do in the organization.
const actingAs = (userId: string, role: string) =>
	Layer.mergeAll(
		Layer.succeed(CurrentOrg, {
			id: ORG,
			name: 'Authz Test',
			slug: 'authz-test',
			role,
		}),
		Layer.succeed(SessionContext, {
			userId,
			email: `${userId}@test.local`,
			name: undefined,
			isAgent: false,
		}),
	)

// Run the way a request does: inside the organization's own database scope, as
// the role a request runs as. Some of what these scenarios rely on is enforced
// down there rather than in the service, and a caller that only stubbed the
// session would be testing looser conditions than production ever has.
const run = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
	userId: string,
	role: string,
) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: { id: ORG, name: 'Authz Test', slug: 'authz-test' } as never,
				userId,
				role,
			})(
				effect.pipe(
					Effect.provide(serviceLayer),
					Effect.provide(actingAs(userId, role)),
				),
			)
		}).pipe(Effect.provide(PgLive)),
	)

const placeholder = new Uint8Array([0])

// Straight to Postgres so the fixture does not depend on the rules under test.
const insertInbox = (args: {
	readonly email: string
	readonly ownerUserId: string | null
	readonly isDefault?: boolean
	readonly isPrivate?: boolean
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{ id: string }>`
			INSERT INTO inboxes (
				organization_id, email, owner_user_id, is_default, is_private,
				imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security, username,
				password_ciphertext, password_nonce, password_tag
			) VALUES (
				${ORG}, ${args.email}, ${args.ownerUserId}, ${args.isDefault ?? false},
				${args.isPrivate ?? false},
				'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', ${args.email},
				${placeholder}, ${placeholder}, ${placeholder}
			)
			RETURNING id
		`
		return rows[0]!.id
	})

// Alice and Bob have to be real members, not just names in a stubbed session:
// handing a mailbox over asks the database who is running the organization,
// rather than believing what the caller says about itself.
const seedMembership = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO "organization" (id, name, slug, "createdAt")
		VALUES (${ORG}, 'Authz Test', 'authz-test', now())
		ON CONFLICT (id) DO NOTHING
	`
	for (const [userId, role] of [
		[ALICE, 'owner'],
		[BOB, 'member'],
	] as const) {
		yield* sql`
			INSERT INTO "user" (id, name, email, "emailVerified")
			VALUES (${userId}, ${userId}, ${`${userId}@test.local`}, true)
			ON CONFLICT (id) DO NOTHING
		`
		yield* sql`
			INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
			VALUES (${`m-${userId}`}, ${ORG}, ${userId}, ${role}, now())
			ON CONFLICT (id) DO NOTHING
		`
	}
})

const cleanup = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`DELETE FROM email_drafts WHERE organization_id = ${ORG}`
	yield* sql`DELETE FROM inbox_footers WHERE organization_id = ${ORG}`
	yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
})

// The organization and its people outlive each scenario; only the mailboxes
// are swept between them.
const dropMembership = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`DELETE FROM member WHERE "organizationId" = ${ORG}`
	yield* sql`DELETE FROM "organization" WHERE id = ${ORG}`
	yield* sql`DELETE FROM "user" WHERE id IN (${ALICE}, ${BOB})`
})

// A half-written message sitting in a mailbox, put there without going through
// the rules being tested.
const insertDraft = (inboxId: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const draftId = `draft_authz_${inboxId.slice(0, 8)}`
		yield* sql`
			INSERT INTO email_drafts ${sql.insert({
				draftId,
				organizationId: ORG,
				inboxId,
				mode: 'new',
				toAddresses: [],
				ccAddresses: [],
				bccAddresses: [],
				subject: 'private thoughts',
				bodyJson: '[]',
			})}
		`
		return draftId
	})

const runPlain = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

// Read back the two things a handover settles, without going through the
// service that performed it.
const readOwnership = (inboxId: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{
			ownerUserId: string | null
			isPrivate: boolean
		}>`
			SELECT owner_user_id, is_private FROM inboxes WHERE id = ${inboxId}
		`
		return rows[0] ?? null
	})

// The mailbox somebody sends from, read straight from the row.
const defaultOf = (userId: string) =>
	runPlain(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* sql<{ email: string }>`
				SELECT email FROM inboxes
				WHERE organization_id = ${ORG}
				  AND owner_user_id = ${userId}
				  AND is_default = true
			`
		}),
	)

describe('who may reach a mailbox', () => {
	beforeAll(async () => {
		await runPlain(seedMembership)
	})

	beforeEach(async () => {
		await runPlain(cleanup)
	})

	afterAll(async () => {
		await runPlain(cleanup)
		await runPlain(dropMembership)
	})

	describe('when the mailbox belongs to a colleague', () => {
		it('should tell an ordinary member it does not exist', async () => {
			// GIVEN a mailbox belonging to Bob
			const id = await runPlain(
				insertInbox({ email: 'bob-only@test.local', ownerUserId: BOB }),
			)
			// WHEN Alice, an ordinary member, tries to change it
			const exit = await run(
				Effect.flip(
					Effect.gen(function* () {
						const svc = yield* EmailService
						return yield* svc.updateInbox(id, { displayName: 'stolen' })
					}),
				),
				ALICE,
				'member',
			)
			// THEN it reads as absent, not as refused — checked by name, since a
			// refusal would confirm the mailbox is there and that is the whole
			// thing this prevents
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(
				Exit.isSuccess(exit) ? (exit.value as { _tag: string })._tag : null,
			).toBe('NotFound')
		})

		it('should refuse an ordinary member the re-test of its password', async () => {
			// GIVEN a mailbox belonging to Bob
			const id = await runPlain(
				insertInbox({ email: 'bob-probe@test.local', ownerUserId: BOB }),
			)
			// WHEN Alice asks to re-test its stored password
			const exit = await run(
				Effect.flip(
					Effect.gen(function* () {
						const svc = yield* EmailService
						return yield* svc.testInbox(id)
					}),
				),
				ALICE,
				'member',
			)
			// THEN she cannot, and again it reads as absent rather than refused,
			// so whether somebody's password still works stays theirs to know
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(
				Exit.isSuccess(exit) ? (exit.value as { _tag: string })._tag : null,
			).toBe('NotFound')
		})

		it('should let an admin change it', async () => {
			// GIVEN a mailbox belonging to Bob
			const id = await runPlain(
				insertInbox({ email: 'bob-admin@test.local', ownerUserId: BOB }),
			)
			// WHEN Alice, who runs the organization, renames it
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateInbox(id, { displayName: 'Renamed' })
				}),
				ALICE,
				'admin',
			)
			// THEN she may: looking after everyone's mailboxes is what running the
			// organization means
			expect(Exit.isSuccess(exit)).toBe(true)
		})

		it('should refuse even an admin the choice of what they send from', async () => {
			// GIVEN a mailbox belonging to Bob
			const id = await runPlain(
				insertInbox({ email: 'bob-default@test.local', ownerUserId: BOB }),
			)
			// WHEN Alice, who runs the organization, tries to make it the one Bob
			// sends from
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateInbox(id, { isDefault: true })
				}),
				ALICE,
				'admin',
			)
			// THEN she cannot: which address somebody sends from is theirs alone
			expect(Exit.isFailure(exit)).toBe(true)
		})

		it('should refuse even an admin taking that choice away', async () => {
			// GIVEN a mailbox Bob already sends from
			const id = await runPlain(
				insertInbox({
					email: 'bob-clear@test.local',
					ownerUserId: BOB,
					isDefault: true,
				}),
			)
			// WHEN Alice, who runs the organization, tries to unset it
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateInbox(id, { isDefault: false })
				}),
				ALICE,
				'admin',
			)
			// THEN she cannot: taking the choice away is still changing it
			expect(Exit.isFailure(exit)).toBe(true)
		})

		it('should refuse handing a mailbox over in the same breath as marking it', async () => {
			// GIVEN a mailbox of Alice's own
			const id = await runPlain(
				insertInbox({ email: 'alice-hand@test.local', ownerUserId: ALICE }),
			)
			// WHEN she hands it to Bob and marks it as a default at once
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateInbox(id, {
						ownerUserId: BOB,
						isDefault: true,
					})
				}),
				ALICE,
				'admin',
			)
			// THEN she cannot, so the two together are no way around the rule
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when a mailbox changes hands', () => {
		it('should not hand the sending choice over with it', async () => {
			// GIVEN a mailbox Alice already sends from, and Bob with none
			const id = await runPlain(
				insertInbox({
					email: 'handover@test.local',
					ownerUserId: ALICE,
					isDefault: true,
				}),
			)
			// WHEN Alice, who runs the organization, hands it to Bob without
			// saying anything about default senders
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateInbox(id, { ownerUserId: BOB })
				}),
				ALICE,
				'admin',
			)
			expect(Exit.isSuccess(exit)).toBe(true)
			// THEN Bob does not silently start sending as that address: the mark
			// comes off, for him to make the choice himself
			expect(await defaultOf(BOB)).toHaveLength(0)
		})

		it('should give it to the whole team, and stop hiding it from them', async () => {
			// GIVEN a mailbox of Bob's that only he can see
			const id = await runPlain(
				insertInbox({
					email: 'to-the-team@test.local',
					ownerUserId: BOB,
					isPrivate: true,
				}),
			)

			// WHEN Alice, who runs the organization, gives it to everybody
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateInbox(id, { ownerUserId: null })
				}),
				ALICE,
				'admin',
			)

			// THEN it belongs to nobody in particular, and is no longer hidden —
			// a mailbox the team owns cannot be kept from them
			expect(Exit.isSuccess(exit)).toBe(true)
			const row = await runPlain(readOwnership(id))
			expect(row).toEqual({ ownerUserId: null, isPrivate: false })
		})
	})

	// The checks above are the application's. This one is the database's, asked
	// directly, because that is the whole point: if the checks above were ever
	// loosened the way an instruction template's once were, this is what would
	// still be standing.
	describe('when a member goes at the owner column directly', () => {
		it('should refuse the write, admin or not', async () => {
			// GIVEN a mailbox belonging to Alice
			const id = await runPlain(
				insertInbox({ email: 'not-yours@test.local', ownerUserId: ALICE }),
			)

			// WHEN Bob, an ordinary member, writes his own name onto it under the
			// role a request actually runs as
			const exit = await Effect.runPromiseExit(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`SET LOCAL ROLE app_user`
							yield* sql`SELECT set_config('app.current_org_id', ${ORG}, true)`
							yield* sql`SELECT set_config('app.current_user_id', ${BOB}, true)`
							yield* sql`
								UPDATE inboxes SET owner_user_id = ${BOB} WHERE id = ${id}
							`
						}),
					)
				}).pipe(Effect.provide(PgLive)),
			)

			// THEN the database refuses it: that column is not a request's to write
			expect(Exit.isFailure(exit)).toBe(true)
			expect(await runPlain(readOwnership(id))).toEqual({
				ownerUserId: ALICE,
				isPrivate: false,
			})
		})
	})

	describe('when the half-written mail is a colleague’s', () => {
		it('should read as absent even when the caller names their own mailbox', async () => {
			// GIVEN a draft sitting in Bob's mailbox, and Alice with her own
			const bobInbox = await runPlain(
				insertInbox({ email: 'bob-drafts@test.local', ownerUserId: BOB }),
			)
			const aliceInbox = await runPlain(
				insertInbox({ email: 'alice-drafts@test.local', ownerUserId: ALICE }),
			)
			const draftId = await runPlain(insertDraft(bobInbox))
			// WHEN Alice asks for it while naming a mailbox that IS hers, which is
			// the way around any check that only looks at what was asked for
			const exit = await run(
				Effect.flip(
					Effect.gen(function* () {
						const svc = yield* EmailService
						return yield* svc.getDraft(aliceInbox, draftId)
					}),
				),
				ALICE,
				'member',
			)
			// THEN it reads as absent: what decides is the mailbox the message
			// would go out from, not the one she asked with
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(
				Exit.isSuccess(exit) ? (exit.value as { _tag: string })._tag : null,
			).toBe('NotFound')
		})

		it('should keep it out of the list when no mailbox is named', async () => {
			// GIVEN a draft in Bob's mailbox and one in Alice's
			const bobInbox = await runPlain(
				insertInbox({ email: 'bob-list@test.local', ownerUserId: BOB }),
			)
			const aliceInbox = await runPlain(
				insertInbox({ email: 'alice-list@test.local', ownerUserId: ALICE }),
			)
			await runPlain(insertDraft(bobInbox))
			await runPlain(insertDraft(aliceInbox))
			// WHEN Alice lists her drafts without naming a mailbox
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.listDrafts()
				}),
				ALICE,
				'member',
			)
			// THEN she sees only her own: naming nothing means hers, not the
			// organization's
			expect(Exit.isSuccess(exit)).toBe(true)
			const items = Exit.isSuccess(exit)
				? (exit.value as { items: ReadonlyArray<{ inboxId: string }> }).items
				: []
			expect(items).toHaveLength(1)
			expect(items[0]?.inboxId).toBe(aliceInbox)
		})
	})

	describe('when the signature belongs to a colleague’s mailbox', () => {
		it('should refuse an ordinary member writing one', async () => {
			// GIVEN a mailbox belonging to Bob
			const id = await runPlain(
				insertInbox({ email: 'bob-footer@test.local', ownerUserId: BOB }),
			)
			// WHEN Alice adds a signature to it
			const exit = await run(
				Effect.flip(
					Effect.gen(function* () {
						const svc = yield* EmailService
						return yield* svc.createFooter({
							inboxId: id,
							name: 'sneaky',
							bodyJson: [],
						})
					}),
				),
				ALICE,
				'member',
			)
			// THEN she cannot: a signature goes out on every message that mailbox
			// sends, so writing one is changing what somebody else's mail says
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(
				Exit.isSuccess(exit) ? (exit.value as { _tag: string })._tag : null,
			).toBe('NotFound')
		})

		it('should keep its signatures out of sight', async () => {
			// GIVEN a mailbox belonging to Bob
			const id = await runPlain(
				insertInbox({ email: 'bob-footer-list@test.local', ownerUserId: BOB }),
			)
			// WHEN Alice lists its signatures
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.listFooters(id)
				}),
				ALICE,
				'member',
			)
			// THEN she sees nothing, rather than being told there is something
			// she may not see
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(Exit.isSuccess(exit) ? exit.value : null).toHaveLength(0)
		})
	})

	describe('when nobody is behind the request', () => {
		it('should manage nothing at all', async () => {
			// GIVEN a mailbox belonging to Bob, and work with no acting member —
			// a webhook, or anything outliving the request that began it
			const id = await runPlain(
				insertInbox({ email: 'bob-unattended@test.local', ownerUserId: BOB }),
			)
			// WHEN that work tries to change it
			const exit = await Effect.runPromiseExit(
				Effect.flip(
					Effect.gen(function* () {
						const svc = yield* EmailService
						return yield* svc.updateInbox(id, { displayName: 'by nobody' })
					}),
				).pipe(
					Effect.provide(serviceLayer),
					Effect.provide(
						Layer.mergeAll(
							Layer.succeed(CurrentOrg, {
								id: ORG,
								name: 'Authz Test',
								slug: 'authz-test',
								role: null,
							}),
							Layer.succeed(SessionContext, {
								userId: 'unattended',
								email: 'unattended@test.local',
								name: undefined,
								isAgent: false,
							}),
						),
					),
					Effect.provide(PgLive),
				),
			)
			// THEN it cannot: carrying no standing means managing nothing, so
			// unattended work can never act on what belongs to one person
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(
				Exit.isSuccess(exit) ? (exit.value as { _tag: string })._tag : null,
			).toBe('NotFound')
		})
	})

	describe('when the mailbox is their own', () => {
		it('should let them change it', async () => {
			// GIVEN a mailbox belonging to Alice
			const id = await runPlain(
				insertInbox({ email: 'alice-own@test.local', ownerUserId: ALICE }),
			)
			// WHEN she renames it
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.updateInbox(id, { description: 'Enquiries' })
				}),
				ALICE,
				'member',
			)
			// THEN she may, without needing to run the organization
			expect(Exit.isSuccess(exit)).toBe(true)
		})

		it('should let them choose what they send from', async () => {
			// GIVEN a mailbox belonging to Alice
			const id = await runPlain(
				insertInbox({ email: 'alice-pick@test.local', ownerUserId: ALICE }),
			)
			// WHEN she picks it as the one she sends from
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.setPrimaryInbox(id)
				}),
				ALICE,
				'member',
			)
			// THEN she may: it is her own choice to make
			expect(Exit.isSuccess(exit)).toBe(true)
		})

		it('should report a mailbox already removed as gone', async () => {
			// GIVEN a mailbox of Alice's that she has already removed
			const id = await runPlain(
				insertInbox({ email: 'alice-gone@test.local', ownerUserId: ALICE }),
			)
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.deleteInbox(id)
				}),
				ALICE,
				'member',
			)
			// WHEN she removes it a second time
			const exit = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.deleteInbox(id)
				}),
				ALICE,
				'member',
			)
			// THEN it says so, rather than reporting a removal that never happened
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when connecting a mailbox', () => {
		const connect = (email: string, extra: Record<string, unknown>) =>
			Effect.gen(function* () {
				const svc = yield* EmailService
				return yield* svc.createInbox({
					email,
					imapHost: 'imap.test',
					imapPort: 993,
					imapSecurity: 'tls',
					smtpHost: 'smtp.test',
					smtpPort: 465,
					smtpSecurity: 'tls',
					username: email,
					password: 'pw',
					...extra,
				} as never)
			})

		it('should refuse an ordinary member naming another owner', async () => {
			// GIVEN Alice, an ordinary member
			// WHEN she connects a mailbox in Bob's name
			const exit = await run(
				connect('for-bob@test.local', { ownerUserId: BOB }),
				ALICE,
				'member',
			)
			// THEN she cannot put a mailbox in somebody else's name
			expect(Exit.isFailure(exit)).toBe(true)
		})

		it('should refuse an ordinary member setting one up for the team', async () => {
			// GIVEN Alice, an ordinary member
			// WHEN she connects a mailbox belonging to the whole team
			const exit = await run(
				connect('team-by-member@test.local', { shared: true }),
				ALICE,
				'member',
			)
			// THEN she cannot: a mailbox for everyone is the organization's to set up
			expect(Exit.isFailure(exit)).toBe(true)
		})

		it('should let an admin set one up for the team', async () => {
			// GIVEN Alice, who runs the organization
			// WHEN she connects a mailbox belonging to the whole team
			const exit = await run(
				connect('team-by-admin@test.local', { shared: true }),
				ALICE,
				'admin',
			)
			// THEN she may
			expect(Exit.isSuccess(exit)).toBe(true)
		})

		it('should make somebody’s first mailbox the one they send from', async () => {
			// GIVEN Alice with no mailbox at all
			// WHEN she connects her first
			const exit = await run(
				connect('alice-first@test.local', {}),
				ALICE,
				'member',
			)
			expect(Exit.isSuccess(exit)).toBe(true)
			// THEN it is already the one she sends from, so sending works without
			// hunting for a setting
			const rows = await runPlain(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql<{ isDefault: boolean }>`
						SELECT is_default FROM inboxes
						WHERE organization_id = ${ORG} AND email = 'alice-first@test.local'
					`
				}),
			)
			expect(rows[0]?.isDefault).toBe(true)
		})

		it('should not make somebody’s first mailbox their default when set up for them', async () => {
			// GIVEN Bob with no mailbox at all
			// WHEN Alice, who runs the organization, connects his first one for him
			const exit = await run(
				connect('for-bob-first@test.local', { ownerUserId: BOB }),
				ALICE,
				'admin',
			)
			expect(Exit.isSuccess(exit)).toBe(true)
			// THEN it is not already what he sends from — the convenience of a
			// first mailbox becoming the default is for the person connecting it
			expect(await defaultOf(BOB)).toHaveLength(0)
		})

		it('should refuse an address already connected', async () => {
			// GIVEN an address already connected and in use
			await runPlain(
				insertInbox({ email: 'twice@test.local', ownerUserId: ALICE }),
			)
			// WHEN Alice connects the same address again, in different case
			const exit = await run(
				Effect.flip(connect('TWICE@test.local', {})),
				ALICE,
				'member',
			)
			// THEN she is told plainly that the address is taken. Asserted as a
			// stated refusal rather than merely "it failed", because the database
			// rule would also turn it down — as a crash nobody can act on, which
			// would let this test pass with the refusal removed.
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(
				Exit.isSuccess(exit) ? (exit.value as { _tag: string })._tag : null,
			).toBe('BadRequest')
		})
	})
})
