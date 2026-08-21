// A follow-up has to reach the recipient inside the conversation it answers,
// carrying that conversation's subject. Get either half wrong and the message
// scores as spam: no subject line at all arrives as "(no subject)", and a
// "Re: " subject with nothing to answer is the classic forged-reply shape.
// These assert on what is handed to the transport, because that — not the row
// we write afterwards — is what the recipient's mail server judges.

// PgLive reads DATABASE_URL at layer-build time (no default). Set it so the
// suite runs without a loaded .env, matching the other integration tests.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Cause, Effect, Exit, Layer, Logger, References } from 'effect'
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
import { MailTransport, type OutboundMessage } from './mail-transport.js'
import { StorageProvider } from './storage-provider.js'
import { TimelineActivityService } from './timeline-activity.js'

const ORG = 'threading-test-org'
// A second tenant, so "the conversation belongs to somebody else" is a real
// row rather than an id that matches nothing.
const OTHER_ORG = 'threading-test-other-org'
const USER = 'threading-user'

// What the transport was handed on the most recent send — the wire message.
let lastOutbound: OutboundMessage | null = null
let sentCount = 0

const stubCrypto = Layer.succeed(CredentialCrypto, {
	encryptPassword: () => ({
		ciphertext: new Uint8Array([0]),
		nonce: new Uint8Array([0]),
		tag: new Uint8Array([0]),
	}),
	decryptPassword: () => 'stubbed-password',
} as never)

// Records the outgoing message instead of sending it, and hands back a
// Message-ID the way SMTP does.
const stubTransport = Layer.succeed(MailTransport, {
	probe: () => Effect.void,
	send: (_creds: unknown, message: OutboundMessage) =>
		Effect.sync(() => {
			lastOutbound = message
			sentCount += 1
			return {
				messageId: `<threading-sent-${sentCount}@taller.test>`,
				raw: new Uint8Array([0]),
			}
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

const actingAs = Layer.mergeAll(
	Layer.succeed(CurrentOrg, {
		id: ORG,
		name: 'Threading Test',
		slug: 'threading-test',
		role: 'owner',
	}),
	Layer.succeed(SessionContext, {
		userId: USER,
		email: `${USER}@test.local`,
		name: undefined,
		isAgent: false,
	}),
)

// Run the way a request does, inside the organization's own database scope.
const scoped = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* enterOrgScope(sql, {
			org: {
				id: ORG,
				name: 'Threading Test',
				slug: 'threading-test',
			} as never,
			userId: USER,
			role: 'owner',
		})(effect.pipe(Effect.provide(serviceLayer), Effect.provide(actingAs)))
	}).pipe(Effect.provide(PgLive))

const run = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
) => Effect.runPromise(scoped(effect))

const runExit = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
) => Effect.runPromiseExit(scoped(effect))

const sqlOnly = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

// Why the send was turned away, so a test that expects a refusal can't be
// satisfied by some unrelated failure earlier in the call. A refusal carries a
// tag of its own and names its reason; anything else answers with neither.
const refusalReason = (exit: Exit.Exit<unknown, unknown>): string => {
	if (Exit.isSuccess(exit)) return ''
	for (const reason of exit.cause.reasons) {
		if (!Cause.isFailReason(reason)) continue
		const error = reason.error as { _tag?: unknown; reason?: unknown }
		if (error?._tag !== 'EmailNotSendable') continue
		return typeof error.reason === 'string' ? error.reason : ''
	}
	return ''
}

const placeholder = new Uint8Array([0])
const body = [
	{
		type: 'paragraph' as const,
		spans: [{ kind: 'text' as const, value: 'Following up on this.' }],
	},
]

let inboxId = ''
let otherInboxId = ''
let companyId = ''

const ROOT_ID = '<threading-root@client.test>'
const LATEST_ID = '<threading-latest@client.test>'

interface SeedMessage {
	readonly messageId: string
	readonly subject: string | null
	// Empty for the conversation's first message; the root's id for later ones.
	readonly references?: readonly string[]
	// Older messages sort first, so "the latest" is a real choice.
	readonly daysAgo?: number
	// Arrived at a fixed instant, so two messages can share one.
	readonly receivedAt?: string
	// Dropped from the server since; still on file, but not a message to
	// answer.
	readonly deleted?: boolean
	// A mailbox other than the suite's default one.
	readonly inboxId?: string
}

// A conversation, seeded straight into the database: how it got there is not
// what is under test. `linkSubject` null is the shape the mail worker used to
// leave behind, and still the shape of every conversation created before this
// fix.
const seedThread = (opts: {
	linkSubject?: string | null
	messages?: readonly SeedMessage[]
	orgId?: string
	externalThreadId?: string
	inboxId?: string
}) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const org = opts.orgId ?? ORG
			const rootId = opts.externalThreadId ?? ROOT_ID
			const links = yield* sql<{ id: string }>`
				INSERT INTO email_thread_links (
					organization_id, inbox_id, external_thread_id, company_id, subject, status
				) VALUES (
					${org}, ${org === ORG ? (opts.inboxId ?? inboxId) : null}, ${rootId},
					${org === ORG ? companyId : null},
					${opts.linkSubject ?? null}, 'open'
				)
				RETURNING id
			`
			for (const message of opts.messages ?? []) {
				yield* sql`
					INSERT INTO email_messages (
						organization_id, inbox_id, folder, message_id, "references",
						subject, received_at, recipients, attachments,
						status, status_updated_at, direction, raw_rfc822_ref,
						deleted_at
					) VALUES (
						${org}, ${org === ORG ? (message.inboxId ?? inboxId) : null}, 'INBOX',
						${message.messageId},
						${(message.references ?? []) as unknown as string[]},
						${message.subject},
						COALESCE(
							${message.receivedAt ?? null}::timestamptz,
							now() - make_interval(days => ${message.daysAgo ?? 0})
						),
						${JSON.stringify({ from: 'client@example.com', to: ['sender@taller.test'], cc: [], bcc: [] })}::jsonb,
						'[]'::jsonb, 'normal', now(), 'inbound', 'sentinel',
						${message.deleted ? new Date().toISOString() : null}::timestamptz
					)
				`
			}
			return links[0]!.id
		}),
	)

// The everyday conversation: a root and a later message, both with subjects.
const seedTwoMessageThread = (linkSubject: string | null) =>
	seedThread({
		linkSubject,
		messages: [
			{ messageId: ROOT_ID, subject: 'your pallet pools', daysAgo: 2 },
			{
				messageId: LATEST_ID,
				subject: 'Re: your pallet pools',
				references: [ROOT_ID],
			},
		],
	})

const threadLinkCount = (org = ORG) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ n: number }>`
				SELECT count(*)::int AS n FROM email_thread_links
				WHERE organization_id = ${org}
			`
			return rows[0]!.n
		}),
	)

const outboundRows = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* sql<{
				subject: string | null
				messageId: string
				inReplyTo: string | null
				references: string[] | null
			}>`
				SELECT subject, message_id, in_reply_to, "references"
				FROM email_messages
				WHERE organization_id = ${ORG} AND direction = 'outbound'
				ORDER BY received_at ASC, message_id ASC
			`
		}),
	)

const createDraft = (
	params: {
		to?: string | undefined
		subject?: string | undefined
		bodyJson?: typeof body | undefined
		inReplyTo?: string | undefined
	},
	context?: {
		companyId?: string
		contactId?: string
		mode?: string
		threadLinkId?: string
	},
) =>
	run(
		Effect.gen(function* () {
			const svc = yield* EmailService
			return yield* svc.createDraft(inboxId, params, context)
		}),
	)

const sendDraft = (draftId: string) =>
	runExit(
		Effect.gen(function* () {
			const svc = yield* EmailService
			return yield* svc.sendDraft(inboxId, draftId)
		}),
	)

const reply = (
	threadId: string,
	extras?: { subject?: string; fallbackSubject?: string },
) =>
	runExit(
		Effect.gen(function* () {
			const svc = yield* EmailService
			return yield* svc.reply(threadId, body, extras)
		}),
	)

beforeAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			// Better Auth owns this table, so its columns are camelCase.
			yield* sql`
				INSERT INTO organization (id, name, slug, "createdAt")
				VALUES (${ORG}, 'Threading Test', 'threading-test', now())
				ON CONFLICT (id) DO NOTHING
			`
			yield* sql`
				INSERT INTO organization (id, name, slug, "createdAt")
				VALUES (${OTHER_ORG}, 'Threading Other', 'threading-other', now())
				ON CONFLICT (id) DO NOTHING
			`
			const companies = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, name, slug)
				VALUES (${ORG}, 'Pallet Co', 'pallet-co')
				ON CONFLICT (organization_id, slug) WHERE deleted_at IS NULL
				DO UPDATE SET name = EXCLUDED.name
				RETURNING id
			`
			companyId = companies[0]!.id
			const inboxes = yield* sql<{ id: string }>`
				INSERT INTO inboxes (
					organization_id, email, owner_user_id, is_default, is_private,
					imap_host, imap_port, imap_security,
					smtp_host, smtp_port, smtp_security, username,
					password_ciphertext, password_nonce, password_tag,
					grant_status, active
				) VALUES (
					${ORG}, 'sender@taller.test', ${USER}, true, false,
					'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', 'sender@taller.test',
					${placeholder}, ${placeholder}, ${placeholder},
					'connected', true
				)
				RETURNING id
			`
			inboxId = inboxes[0]!.id
			const others = yield* sql<{ id: string }>`
				INSERT INTO inboxes (
					organization_id, email, owner_user_id, is_default, is_private,
					imap_host, imap_port, imap_security,
					smtp_host, smtp_port, smtp_security, username,
					password_ciphertext, password_nonce, password_tag,
					grant_status, active
				) VALUES (
					${ORG}, 'other@taller.test', ${USER}, false, false,
					'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', 'other@taller.test',
					${placeholder}, ${placeholder}, ${placeholder},
					'connected', true
				)
				RETURNING id
			`
			otherInboxId = others[0]!.id
		}),
	)
})

const wipe = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const org of [ORG, OTHER_ORG]) {
				yield* sql`DELETE FROM email_drafts WHERE organization_id = ${org}`
				yield* sql`DELETE FROM email_messages WHERE organization_id = ${org}`
				yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${org}`
			}
		}),
	)

beforeEach(async () => {
	lastOutbound = null
	await wipe()
})

afterAll(async () => {
	await wipe()
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM companies WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER_ORG})`
		}),
	)
})

describe('EmailService.reply', () => {
	describe('when the conversation carries no subject of its own', () => {
		it('should send the first message\'s subject, prefixed "Re: "', async () => {
			// GIVEN a conversation the mail worker created, whose row has no subject
			const threadId = await seedTwoMessageThread(null)

			// WHEN a reply is sent
			await reply(threadId)

			// THEN the message goes out with a real subject line
			// AND this is the case that used to arrive as "(no subject)"
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should treat an empty subject on the row the same as none', async () => {
			// GIVEN a conversation whose subject column holds an empty string
			// WHEN a reply is sent
			// THEN it borrows the first message's subject just the same
			// [NULLIF(tl.subject, '')]
			const threadId = await seedTwoMessageThread('')
			await reply(threadId)
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should skip messages that have no subject when borrowing one', async () => {
			// GIVEN the earliest message carries no subject and a later one does
			const threadId = await seedThread({
				linkSubject: null,
				messages: [
					{ messageId: ROOT_ID, subject: null, daysAgo: 3 },
					{
						messageId: '<threading-blank@client.test>',
						subject: '',
						references: [ROOT_ID],
						daysAgo: 2,
					},
					{
						messageId: LATEST_ID,
						subject: 'your pallet pools',
						references: [ROOT_ID],
						daysAgo: 1,
					},
				],
			})

			// WHEN a reply is sent
			await reply(threadId)

			// THEN it borrows the earliest one that actually has a subject
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should refuse when no message on the conversation has a subject', async () => {
			// GIVEN nothing anywhere to borrow a subject from
			const threadId = await seedThread({
				linkSubject: null,
				messages: [{ messageId: ROOT_ID, subject: null }],
			})

			// WHEN a reply is sent
			const exit = await reply(threadId)

			// THEN it is refused rather than delivered with no subject line
			expect(refusalReason(exit)).toBe('no_subject')
			expect(lastOutbound).toBeNull()
		})

		it('should send when the caller supplies the subject itself', async () => {
			// GIVEN the same conversation, with nothing to borrow
			const threadId = await seedThread({
				linkSubject: null,
				messages: [{ messageId: ROOT_ID, subject: null }],
			})

			// WHEN a reply names its own subject
			await reply(threadId, { subject: 'Re: the pallet pools' })

			// THEN it goes out under that subject
			// AND this is the way out of a conversation that has no subject to
			// borrow, so the refusal above is something the caller can act on
			expect(lastOutbound?.subject).toBe('Re: the pallet pools')
			expect(lastOutbound?.inReplyTo).toBe(ROOT_ID)
		})

		it('should still refuse when the supplied subject is blank', async () => {
			// GIVEN nothing to borrow and a subject of only spaces
			const threadId = await seedThread({
				linkSubject: null,
				messages: [{ messageId: ROOT_ID, subject: null }],
			})

			// WHEN a reply is sent
			const exit = await reply(threadId, { subject: '   ' })

			// THEN a blank one counts for nothing and the send is still refused
			expect(refusalReason(exit)).toBe('no_subject')
			expect(lastOutbound).toBeNull()
		})
	})

	describe('when the caller chooses the subject', () => {
		it("should use it instead of the conversation's own", async () => {
			// GIVEN a conversation that has a subject of its own
			const threadId = await seedTwoMessageThread('your pallet pools')

			// WHEN a reply names a different one, the way a mail client lets
			// you edit the line before sending
			await reply(threadId, { subject: 'Revised quote' })

			// THEN the chosen one goes out untouched, with no prefix added
			expect(lastOutbound?.subject).toBe('Revised quote')
		})

		it('should still thread the message', async () => {
			// GIVEN a conversation and a reply under a changed subject
			const threadId = await seedTwoMessageThread('your pallet pools')

			// WHEN it is sent
			await reply(threadId, { subject: 'Revised quote' })

			// THEN it is still a reply: the headers put it in the conversation
			// AND the recipient's mail client threads on those, not the subject
			expect(lastOutbound?.inReplyTo).toBe(LATEST_ID)
			expect(lastOutbound?.references).toContain(ROOT_ID)
		})

		it('should record the subject that went out', async () => {
			// GIVEN a reply under a chosen subject
			const threadId = await seedTwoMessageThread('your pallet pools')

			// WHEN it is sent
			await reply(threadId, { subject: 'Revised quote' })

			// THEN the stored row says what the recipient saw
			const rows = await outboundRows()
			expect(rows[0]?.subject).toBe('Revised quote')
		})
	})

	describe('when the conversation already carries a subject', () => {
		it('should prefix a plain one once', async () => {
			// GIVEN a conversation whose row holds a plain subject
			const threadId = await seedTwoMessageThread('your pallet pools')

			// WHEN a reply is sent
			await reply(threadId)

			// THEN it goes out prefixed
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should not prefix one that already reads as a reply', async () => {
			// GIVEN a subject that already carries the prefix
			const threadId = await seedTwoMessageThread('Re: your pallet pools')

			// WHEN a reply is sent
			// THEN it is left alone rather than stacked into "Re: Re: "
			await reply(threadId)
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should not prefix one whose existing prefix is lower case', async () => {
			// GIVEN the prefix as some mail clients write it
			// WHEN a reply is sent
			// THEN it is still recognised as already prefixed
			// [toLowerCase().startsWith('re:')]
			const threadId = await seedTwoMessageThread('re: your pallet pools')
			await reply(threadId)
			expect(lastOutbound?.subject).toBe('re: your pallet pools')
		})
	})

	describe('when the reply goes out', () => {
		it('should answer the most recent message and reach back to the first', async () => {
			// GIVEN a conversation with a root and a later message
			const threadId = await seedTwoMessageThread(null)

			// WHEN a reply is sent
			await reply(threadId)

			// THEN it answers the latest message
			// AND the chain reaches back to the conversation's first message
			expect(lastOutbound?.inReplyTo).toBe(LATEST_ID)
			expect(lastOutbound?.references).toContain(ROOT_ID)
		})

		it('should not repeat the same id when the conversation holds only one message', async () => {
			// GIVEN a conversation whose only message is its root, so the
			// message being answered and the conversation root are the same id
			const threadId = await seedThread({
				linkSubject: null,
				messages: [{ messageId: ROOT_ID, subject: 'your pallet pools' }],
			})

			// WHEN a reply is sent
			await reply(threadId)

			// THEN References names it once rather than twice
			expect(lastOutbound?.inReplyTo).toBe(ROOT_ID)
			expect(lastOutbound?.references).toEqual([ROOT_ID])
		})

		it('should record what the recipient actually saw', async () => {
			// GIVEN a conversation with no subject of its own
			const threadId = await seedTwoMessageThread(null)

			// WHEN a reply is sent
			await reply(threadId)

			// THEN the stored row carries the subject that went out, "Re: " and all
			const rows = await outboundRows()
			expect(rows[0]?.subject).toBe('Re: your pallet pools')
		})

		it('should stay in the same conversation', async () => {
			// GIVEN an existing conversation
			const threadId = await seedTwoMessageThread(null)

			// WHEN a reply is sent
			await reply(threadId)

			// THEN no second conversation appears for the contact
			expect(await threadLinkCount()).toBe(1)
		})
	})
})

describe('EmailService.send', () => {
	describe('when a new conversation is started', () => {
		it('should send under the subject it was given', async () => {
			// GIVEN a plain subject
			// WHEN a new message is sent
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.send(
						inboxId,
						'client@example.com',
						'your pallet pools',
						body,
						companyId,
					)
				}),
			)

			// THEN it goes out with that subject and no threading headers
			expect(lastOutbound?.subject).toBe('your pallet pools')
			expect(lastOutbound?.inReplyTo).toBeUndefined()
		})

		it('should refuse a "Re: " subject, because this path threads nothing', async () => {
			// GIVEN a follow-up written as a reply on the path that starts new
			// conversations — the shape that reached real prospects as a
			// forged reply
			const exit = await runExit(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.send(
						inboxId,
						'client@example.com',
						'Re: your pallet pools',
						body,
						companyId,
					)
				}),
			)

			// THEN the send is refused, and nothing reached the transport
			expect(refusalReason(exit)).toBe('forged_reply')
			expect(lastOutbound).toBeNull()
		})

		it('should refuse an empty subject', async () => {
			// GIVEN no subject
			const exit = await runExit(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.send(
						inboxId,
						'client@example.com',
						'',
						body,
						companyId,
					)
				}),
			)

			// THEN the send is refused rather than arriving as "(no subject)"
			expect(refusalReason(exit)).toBe('no_subject')
			expect(lastOutbound).toBeNull()
		})

		it('should leave no conversation behind when the send is refused', async () => {
			// GIVEN a refused send
			await runExit(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.send(
						inboxId,
						'client@example.com',
						'Re: your pallet pools',
						body,
						companyId,
					)
				}),
			)

			// THEN no conversation row was created for a message never sent
			expect(await threadLinkCount()).toBe(0)
		})
	})
})

describe('EmailService.sendDraft', () => {
	describe('when the draft names the conversation it answers', () => {
		it('should thread it without being told the draft is a reply', async () => {
			// GIVEN a draft carrying a thread but no mode — the shape every
			// agent produced, and the one that used to open a second
			// conversation and go out looking like a forged reply
			const threadId = await seedTwoMessageThread(null)
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Re: your pallet pools',
					bodyJson: body,
				},
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN the message answers the latest message in the conversation
			expect(lastOutbound?.inReplyTo).toBe(LATEST_ID)
			expect(lastOutbound?.references).toContain(ROOT_ID)
		})

		it('should not open a second conversation', async () => {
			// GIVEN the same draft
			const threadId = await seedTwoMessageThread(null)
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Re: your pallet pools',
					bodyJson: body,
				},
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN the contact still has one conversation, not two
			expect(await threadLinkCount()).toBe(1)
		})

		it('should keep a subject the writer chose', async () => {
			// GIVEN a draft that answers a thread under its own subject
			const threadId = await seedTwoMessageThread('your pallet pools')
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Revised quote',
					bodyJson: body,
				},
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN the thread's subject does not overwrite it
			expect(lastOutbound?.subject).toBe('Revised quote')
		})

		it("should borrow the conversation's subject when the draft has none", async () => {
			// GIVEN a draft with no subject on a conversation that has one
			const threadId = await seedTwoMessageThread(null)
			const draft = await createDraft(
				{ to: 'client@example.com', bodyJson: body },
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN it goes out under the conversation's subject
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should treat a blank-space subject as none', async () => {
			// GIVEN a draft whose subject is only spaces
			const threadId = await seedTwoMessageThread(null)
			const draft = await createDraft(
				{ to: 'client@example.com', subject: '   ', bodyJson: body },
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			// THEN it borrows the conversation's subject rather than sending blank
			// [draft.subject.trim() !== '']
			await sendDraft(draft.draftId)
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should not stack a prefix on a conversation subject that has one', async () => {
			// GIVEN a conversation already named "Re: …" and a draft with no subject
			const threadId = await seedTwoMessageThread('Re: your pallet pools')
			const draft = await createDraft(
				{ to: 'client@example.com', bodyJson: body },
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			// THEN the borrowed subject is used as-is
			await sendDraft(draft.draftId)
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})

		it('should fall back to the conversation root when it holds no messages', async () => {
			// GIVEN a conversation row with nothing under it yet
			const threadId = await seedThread({
				linkSubject: 'your pallet pools',
				messages: [],
			})
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Re: your pallet pools',
					bodyJson: body,
				},
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN there is no parent message to name, so the conversation's own
			// id answers for it and the message still threads
			expect(lastOutbound?.inReplyTo).toBe(ROOT_ID)
			expect(lastOutbound?.references).toEqual([ROOT_ID])
		})
	})

	describe('when the draft names its parent by Message-ID', () => {
		it('should find the conversation from it and thread the message', async () => {
			// GIVEN a draft carrying in_reply_to and no thread link — a value
			// that was being written down and never read
			await seedTwoMessageThread(null)
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Re: your pallet pools',
					bodyJson: body,
					inReplyTo: LATEST_ID,
				},
				{ companyId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN the message threads, and no second conversation appears
			expect(lastOutbound?.references).toContain(ROOT_ID)
			expect(await threadLinkCount()).toBe(1)
		})

		it('should let an explicit thread link win over it', async () => {
			// GIVEN a draft naming one conversation by link and a message on a
			// different conversation by Message-ID
			const threadId = await seedTwoMessageThread(null)
			const otherRoot = '<threading-other-root@client.test>'
			await seedThread({
				linkSubject: 'a different conversation',
				externalThreadId: otherRoot,
				messages: [{ messageId: otherRoot, subject: 'a different one' }],
			})
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Re: your pallet pools',
					bodyJson: body,
					inReplyTo: otherRoot,
				},
				{ companyId, threadLinkId: threadId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN the link decides, and the Message-ID is not consulted
			// [!threadLinkId && draft.inReplyTo]
			expect(lastOutbound?.references).toContain(ROOT_ID)
			expect(lastOutbound?.references).not.toContain(otherRoot)
		})

		it('should start a new conversation when the parent is unknown', async () => {
			// GIVEN a Message-ID nothing on file matches
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'a fresh start',
					bodyJson: body,
					inReplyTo: '<nobody-has-this@elsewhere.test>',
				},
				{ companyId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN nothing is threaded, and the message opens its own conversation
			expect(lastOutbound).not.toBeNull()
			expect(lastOutbound?.inReplyTo).toBeUndefined()
			expect(await threadLinkCount()).toBe(1)
		})

		it('should not reach a parent belonging to another organization', async () => {
			// GIVEN the parent message sits in a different tenant
			const foreignRoot = '<threading-foreign@client.test>'
			await seedThread({
				orgId: OTHER_ORG,
				linkSubject: 'somebody else’s conversation',
				externalThreadId: foreignRoot,
				messages: [{ messageId: foreignRoot, subject: 'theirs' }],
			})
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'a fresh start',
					bodyJson: body,
					inReplyTo: foreignRoot,
				},
				{ companyId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN the message goes out threading nothing, rather than joining
			// their conversation
			expect(lastOutbound).not.toBeNull()
			expect(lastOutbound?.inReplyTo).toBeUndefined()
			expect(lastOutbound?.references).toBeUndefined()
			// AND it opens a conversation of our own, leaving theirs alone
			expect(await threadLinkCount()).toBe(1)
			expect(await threadLinkCount(OTHER_ORG)).toBe(1)
		})
	})

	describe('when the draft names a conversation it may not touch', () => {
		it("should not thread onto another organization's conversation", async () => {
			// GIVEN a thread link id that belongs to a different tenant
			const foreignRoot = '<threading-foreign-link@client.test>'
			const foreignThreadId = await seedThread({
				orgId: OTHER_ORG,
				linkSubject: 'somebody else’s conversation',
				externalThreadId: foreignRoot,
				messages: [{ messageId: foreignRoot, subject: 'theirs' }],
			})
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'a fresh start',
					bodyJson: body,
				},
				{ companyId, threadLinkId: foreignThreadId },
			)

			// WHEN it is sent
			await sendDraft(draft.draftId)

			// THEN the lookup finds nothing and the message goes out fresh
			expect(lastOutbound).not.toBeNull()
			expect(lastOutbound?.inReplyTo).toBeUndefined()
			expect(lastOutbound?.references).toBeUndefined()
			// AND it opens a conversation of our own, leaving theirs alone
			expect(await threadLinkCount()).toBe(1)
			expect(await threadLinkCount(OTHER_ORG)).toBe(1)
		})
	})

	describe('when the draft starts a new conversation', () => {
		it('should refuse a "Re: " subject that answers nothing', async () => {
			// GIVEN a draft with a reply subject and no conversation behind it
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Re: your pallet pools',
					bodyJson: body,
				},
				{ companyId },
			)

			// WHEN it is sent
			const exit = await sendDraft(draft.draftId)

			// THEN the send is refused rather than delivered as a forged reply
			// AND nothing went to the transport
			expect(refusalReason(exit)).toBe('forged_reply')
			expect(lastOutbound).toBeNull()
		})

		it('should refuse a draft with no subject at all', async () => {
			// GIVEN a draft nobody gave a subject, and no conversation to
			// borrow one from
			const draft = await createDraft(
				{ to: 'client@example.com', bodyJson: body },
				{ companyId },
			)

			// WHEN it is sent
			const exit = await sendDraft(draft.draftId)

			// THEN the send is refused rather than arriving as "(no subject)"
			expect(refusalReason(exit)).toBe('no_subject')
			expect(lastOutbound).toBeNull()
		})

		it('should keep the draft when the send is refused', async () => {
			// GIVEN a refused draft
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'Re: your pallet pools',
					bodyJson: body,
				},
				{ companyId },
			)
			await sendDraft(draft.draftId)

			// THEN it is still there to be corrected and sent again, rather
			// than deleted along with the message that never went
			const found = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.getDraft(inboxId, draft.draftId)
				}),
			)
			expect(found).not.toBeNull()
		})
	})
})

describe('replying twice on the same conversation', () => {
	it('should build the second chain on what the first one sent', async () => {
		// GIVEN a conversation that has already been answered once, so the
		// message being answered now is our own
		const threadId = await seedTwoMessageThread(null)
		await reply(threadId)
		const firstSent = lastOutbound?.references ?? []

		// WHEN a second reply goes out
		await reply(threadId)

		// THEN it carries everything the first one did, plus the first reply
		// itself — the chain grows rather than resetting to two entries
		for (const id of firstSent) {
			expect(lastOutbound?.references).toContain(id)
		}
		expect(lastOutbound?.references?.length ?? 0).toBeGreaterThan(
			firstSent.length,
		)
		expect(lastOutbound?.references?.at(-1)).toBe(lastOutbound?.inReplyTo)
	})

	it('should store the headers each message actually carried', async () => {
		// GIVEN two replies on one conversation
		const threadId = await seedTwoMessageThread(null)
		await reply(threadId)
		await reply(threadId)

		// THEN each stored row says what went on the wire, not a shorter chain
		// invented afterwards — the next reply reads these back
		const rows = await outboundRows()
		expect(rows).toHaveLength(2)
		expect(rows[0]?.inReplyTo).toBe(LATEST_ID)
		expect(rows[1]?.references).toContain(ROOT_ID)
		expect(rows[1]?.references?.length ?? 0).toBeGreaterThan(
			rows[0]?.references?.length ?? 0,
		)
	})

	it('should keep the conversation findable from every message it sent', async () => {
		// GIVEN two replies
		const threadId = await seedTwoMessageThread(null)
		await reply(threadId)
		await reply(threadId)

		// THEN both rows still name the conversation's first message, which is
		// what every lookup searches for
		const rows = await outboundRows()
		for (const row of rows) {
			expect(row.references).toContain(ROOT_ID)
		}
	})
})

describe('a subject already written as a reply', () => {
	it('should not be stacked on, however the prefix is spaced', async () => {
		// GIVEN a conversation whose subject uses the spacing French clients
		// write, which is still a reply prefix
		const threadId = await seedTwoMessageThread('Re : your pallet pools')

		// WHEN a reply is sent
		await reply(threadId)

		// THEN it is left alone rather than stacked into "Re: Re : ..."
		expect(lastOutbound?.subject).toBe('Re : your pallet pools')
	})

	it('should read the same way when a draft borrows it', async () => {
		// GIVEN the same conversation, answered by a draft with no subject
		const threadId = await seedTwoMessageThread('Re : your pallet pools')
		const draft = await createDraft(
			{ to: 'client@example.com', bodyJson: body },
			{ companyId, threadLinkId: threadId },
		)

		// WHEN it is sent
		await sendDraft(draft.draftId)

		// THEN both send paths agree on what already counts as a reply
		expect(lastOutbound?.subject).toBe('Re : your pallet pools')
	})
})

describe('a draft on a conversation with no subject anywhere', () => {
	it('should be refused rather than sent blank', async () => {
		// GIVEN a conversation with nothing to borrow and a draft with no
		// subject of its own
		const threadId = await seedThread({
			linkSubject: null,
			messages: [{ messageId: ROOT_ID, subject: null }],
		})
		const draft = await createDraft(
			{ to: 'client@example.com', bodyJson: body },
			{ companyId, threadLinkId: threadId },
		)

		// WHEN it is sent
		const exit = await sendDraft(draft.draftId)

		// THEN it is refused, the same way the reply path refuses it
		expect(refusalReason(exit)).toBe('no_subject')
		expect(lastOutbound).toBeNull()
	})
})

describe('a conversation whose subject is only blank space', () => {
	it('should not be treated as a subject to borrow', async () => {
		// GIVEN a subject that looks present but says nothing
		const threadId = await seedThread({
			linkSubject: '   ',
			messages: [
				{ messageId: ROOT_ID, subject: '   ', daysAgo: 2 },
				{
					messageId: LATEST_ID,
					subject: 'your pallet pools',
					references: [ROOT_ID],
				},
			],
		})

		// WHEN a reply is sent
		await reply(threadId)

		// THEN the blank one is passed over for a real one, rather than going
		// out as "Re:    "
		expect(lastOutbound?.subject).toBe('Re: your pallet pools')
	})
})

describe('the record a refused send leaves', () => {
	// A message that never went out is still something that happened on the
	// outbound path, so it says so on a line of its own — the way a send that
	// went through does. Without it, "how often are we refusing sends, and
	// over what" cannot be answered at all.
	const runCapturingLogs = async (effect: Parameters<typeof runExit>[0]) => {
		const lines: Array<{
			level: string
			annotations: Record<string, unknown>
		}> = []
		const capture = Logger.layer([
			Logger.make(options => {
				lines.push({
					level: String(options.logLevel),
					annotations: options.fiber.getRef(
						References.CurrentLogAnnotations,
					) as Record<string, unknown>,
				})
			}),
		]).pipe(
			Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, 'Debug')),
		)
		await Effect.runPromiseExit(
			scoped(effect).pipe(Effect.provide(capture)) as Effect.Effect<
				unknown,
				unknown,
				never
			>,
		)
		return lines
	}

	it('should name the reason it was refused', async () => {
		// GIVEN a follow-up written as a reply on the path that threads nothing
		const lines = await runCapturingLogs(
			Effect.gen(function* () {
				const svc = yield* EmailService
				return yield* svc.send(
					inboxId,
					'client@example.com',
					'Re: your pallet pools',
					body,
					companyId,
				)
			}),
		)

		// THEN a record says so, and says which of the two shapes it was
		const refused = lines.find(l => l.annotations['event'] === 'email.refused')
		expect(refused).toBeDefined()
		expect(refused?.annotations['reason']).toBe('forged_reply')
	})

	it('should say it at a level that is read in production', async () => {
		// GIVEN the same refused send
		const lines = await runCapturingLogs(
			Effect.gen(function* () {
				const svc = yield* EmailService
				return yield* svc.send(
					inboxId,
					'client@example.com',
					'',
					body,
					companyId,
				)
			}),
		)

		// THEN it is a warning: nothing of ours failed, but a message did not go
		// AND debug would be dropped by the production floor, which is Info
		const refused = lines.find(l => l.annotations['event'] === 'email.refused')
		expect(refused?.annotations['reason']).toBe('no_subject')
		expect(refused?.level).toBe('Warn')
	})

	it('should not write down what the message said', async () => {
		// GIVEN a refused send whose subject is the customer's own words
		const lines = await runCapturingLogs(
			Effect.gen(function* () {
				const svc = yield* EmailService
				return yield* svc.send(
					inboxId,
					'client@example.com',
					'Re: pressupost pallets Barcelona',
					body,
					companyId,
				)
			}),
		)

		// THEN neither the subject nor the recipient reaches the record
		const refused = lines.find(l => l.annotations['event'] === 'email.refused')
		const written = JSON.stringify(refused)
		expect(written).not.toContain('pressupost')
		expect(written).not.toContain('client@example.com')
	})
})

describe('the message a reply answers', () => {
	describe('when the newest message has been dropped from the server', () => {
		it('should answer the newest one still there', async () => {
			// GIVEN a conversation whose most recent message has since been
			// deleted on the mail server
			const threadId = await seedThread({
				linkSubject: 'your pallet pools',
				messages: [
					{ messageId: ROOT_ID, subject: 'your pallet pools', daysAgo: 2 },
					{
						messageId: LATEST_ID,
						subject: 'Re: your pallet pools',
						references: [ROOT_ID],
						daysAgo: 1,
						deleted: true,
					},
				],
			})

			// WHEN a reply is sent
			await reply(threadId)

			// THEN it answers the message that is still there
			// AND naming a deleted one would point the recipient's mail client
			// at something nobody can see
			expect(lastOutbound?.inReplyTo).toBe(ROOT_ID)
		})
	})
})

describe('a reply on a conversation with no subject to borrow', () => {
	describe('when the caller offers one to fall back on', () => {
		it('should send under it rather than being refused', async () => {
			// GIVEN a conversation with nothing to borrow — the shape an
			// invitation thread can have — and a caller that must get its
			// message out, as the calendar reply does
			const threadId = await seedThread({
				linkSubject: null,
				messages: [{ messageId: ROOT_ID, subject: null }],
			})

			// WHEN a reply offers a subject to fall back on
			await reply(threadId, { fallbackSubject: 'Quarterly planning' })

			// THEN it goes out under that, prefixed like any other reply
			expect(lastOutbound?.subject).toBe('Re: Quarterly planning')
		})

		it('should still prefer a subject the conversation has', async () => {
			// GIVEN a conversation that does have one
			const threadId = await seedTwoMessageThread('your pallet pools')

			// WHEN a reply also offers a fallback
			await reply(threadId, { fallbackSubject: 'Quarterly planning' })

			// THEN the conversation's own wins — the fallback is only for
			// having nothing at all
			expect(lastOutbound?.subject).toBe('Re: your pallet pools')
		})
	})
})

describe('a draft answering a conversation in another mailbox', () => {
	describe('when the conversation belongs to a different mailbox of the same organization', () => {
		it('should not be filed onto it', async () => {
			// GIVEN a conversation that lives in a colleague's mailbox
			const foreignRoot = '<other-mailbox@client.test>'
			const foreignThreadId = await seedThread({
				linkSubject: 'their conversation',
				externalThreadId: foreignRoot,
				inboxId: otherInboxId,
				messages: [{ messageId: foreignRoot, subject: 'theirs' }],
			})
			const draft = await createDraft(
				{
					to: 'client@example.com',
					subject: 'a fresh start',
					bodyJson: body,
				},
				{ companyId, threadLinkId: foreignThreadId },
			)

			// WHEN it is sent from this mailbox
			await sendDraft(draft.draftId)

			// THEN it starts its own conversation instead
			// AND a message going out from one mailbox never joins a
			// conversation belonging to another
			expect(lastOutbound).not.toBeNull()
			expect(lastOutbound?.inReplyTo).toBeUndefined()
		})
	})
})
