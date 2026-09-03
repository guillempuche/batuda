// What `manage_email_draft` does with the parameters it accepts, driven
// through the real handler the way a `tools/call` would.
//
// The case that matters is the one seen on production: a draft was attached to
// an existing conversation with `action:"update"`, the call answered with a
// success and a fresh `updatedAt`, and nothing had been applied. The message
// then went out as a brand-new conversation — its own message id and thread id
// came back identical — and a second, disconnected conversation appeared for
// the same company. The service having the capability is not enough on its
// own — the handler decides which of a tool's parameters reach it — so this
// suite drives the handler rather than the service one layer down.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Effect, Layer, Stream } from 'effect'
import { McpSchema } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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

const ORG = 'draft-threading-test-org'
const ALICE = 'draft-threading-alice'
const ADDRESS = 'alice-threading@taller.test'

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
	// Nothing here asks anybody a question, so a client that would have to
	// answer is never built.
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
		name: 'Draft Threading Test',
		slug: 'draft-threading-test',
		role: 'member',
	} as never),
	Layer.succeed(SessionContext, {
		userId: ALICE,
		email: `${ALICE}@test.local`,
		name: undefined,
		isAgent: false,
	} as never),
)

// One `tools/call`, inside the org scope the /mcp middleware applies.
const callTool = (params: Record<string, unknown>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: { id: ORG, name: 'Draft Threading Test', slug: 'x' } as never,
				userId: ALICE,
				role: 'member',
			})(
				Effect.gen(function* () {
					const toolkit = yield* EmailTools
					// `handle` answers with a stream of results; one tool call
					// produces one.
					const stream = yield* toolkit.handle(
						'manage_email_draft',
						params as never,
					)
					const [first] = yield* Stream.runCollect(stream)
					return (first?.result ?? null) as Record<string, unknown> | null
				}).pipe(
					Effect.provide(handlers),
					Effect.provide(actingAs),
					// The toolkit's own handle still asks for a client to put a
					// question to, even where no tool here would ask one.
					Effect.provide(stubs),
				),
			)
		}).pipe(Effect.provide(PgLive)),
	)

// The same call, reporting a refusal as text instead of throwing it.
const callToolExit = (params: Record<string, unknown>) =>
	callTool(params).then(
		() => 'no refusal',
		(error: unknown) => String(error),
	)

const sqlOnly = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

// The handler answers with the encoded draft; only these fields are read.
const draftFrom = (outcome: unknown) =>
	outcome as {
		draftId: string
		clientId?: string
		mode: string
		threadLinkId?: string
		subject?: string
	}

let inboxId = ''
let threadSeq = 0

const insertThreadLink = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			threadSeq += 1
			const rows = yield* sql<{ id: string }>`
				INSERT INTO email_thread_links (
					organization_id, external_thread_id, subject
				) VALUES (${ORG}, ${`<t-${threadSeq}@taller.test>`}, 'your quote')
				RETURNING id
			`
			return rows[0]!.id
		}),
	)

// A second mailbox in the same organization, for a conversation this draft's
// mailbox has no part in.
const insertOtherInbox = () =>
	sqlOnly(
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
					${ORG}, ${'other-threading@taller.test'}, ${ALICE}, false, false,
					'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', 'other',
					${placeholder}, ${placeholder}, ${placeholder},
					'connected', true
				)
				RETURNING id
			`
			return rows[0]!.id
		}),
	)

const insertThreadLinkIn = (inbox: string) =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			threadSeq += 1
			const rows = yield* sql<{ id: string }>`
				INSERT INTO email_thread_links (
					organization_id, external_thread_id, subject, inbox_id
				) VALUES (
					${ORG}, ${`<other-${threadSeq}@taller.test>`}, 'elsewhere', ${inbox}
				)
				RETURNING id
			`
			return rows[0]!.id
		}),
	)

beforeAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			// Better Auth owns this table, so its columns are camelCase.
			yield* sql`
				INSERT INTO organization (id, name, slug, "createdAt")
				VALUES (${ORG}, 'Draft Threading Test', 'draft-threading-test', now())
				ON CONFLICT (id) DO NOTHING
			`
		}),
	)
})

beforeEach(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM email_drafts WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
		}),
	)
	inboxId = await sqlOnly(
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
					${ORG}, ${ADDRESS}, ${ALICE}, true, false,
					'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', ${ADDRESS},
					${placeholder}, ${placeholder}, ${placeholder},
					'connected', true
				)
				RETURNING id
			`
			return rows[0]!.id
		}),
	)
})

afterAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM email_drafts WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM organization WHERE id = ${ORG}`
		}),
	)
})

const startDraft = async () =>
	draftFrom(
		await callTool({
			action: 'create',
			inbox_id: inboxId,
			to: 'client@example.com',
			subject: 'Quote',
			body_json: [
				{ type: 'paragraph', spans: [{ kind: 'text', value: 'Hello.' }] },
			],
		}),
	)

describe('manage_email_draft', () => {
	describe('when a conversation is named on an update', () => {
		it('should attach the draft to it', async () => {
			// GIVEN a draft that answers nothing yet, and a conversation
			const draft = await startDraft()
			const threadLinkId = await insertThreadLink()

			// WHEN the conversation is named through the tool, exactly as a client
			// would name it
			const updated = draftFrom(
				await callTool({
					action: 'update',
					draft_id: draft.draftId,
					mode: 'reply',
					thread_link_id: threadLinkId,
				}),
			)

			// THEN it is attached. A call that reports success while dropping
			// what it was given is the worst shape this can fail in: the message
			// goes out starting a new conversation, and nothing says so until
			// somebody reads the sent mail
			expect(updated.threadLinkId).toBe(threadLinkId)
			expect(updated.mode).toBe('reply')
			expect(updated.clientId).toContain(`threadLinkId=${threadLinkId}`)
		})

		it('should let the subject be cleared in the same breath', async () => {
			// GIVEN a draft carrying a subject written for a new conversation
			const draft = await startDraft()
			const threadLinkId = await insertThreadLink()

			// WHEN it becomes a reply, whose subject should come from the
			// conversation rather than from what was typed first
			const updated = draftFrom(
				await callTool({
					action: 'update',
					draft_id: draft.draftId,
					mode: 'reply',
					thread_link_id: threadLinkId,
					subject: null,
				}),
			)

			// THEN the old subject is gone. Leaving the key out means "unchanged",
			// so without an explicit null a subject could be set and never taken
			// back off
			expect(updated.subject).toBeUndefined()
		})
	})

	describe('when the conversation named cannot be answered', () => {
		it('should say no such thread rather than fail inside', async () => {
			// GIVEN a draft, and a value that is not a conversation id at all —
			// an assistant holding the Message-ID reaches for it, since the same
			// tool takes exactly that string under in_reply_to
			const draft = await startDraft()

			// WHEN it is named on an update
			const outcome = await callToolExit({
				action: 'update',
				draft_id: draft.draftId,
				thread_link_id: '<CAF=x@mail.gmail.com>',
			})

			// THEN the caller is told which id was wrong. Written straight to the
			// column it reaches Postgres as a bad uuid, which comes back as an
			// internal fault and loses the body edits sent in the same call
			expect(outcome).toContain('EmailThread')
			expect(outcome).not.toContain('internal server error')
		})

		it('should refuse a conversation belonging to another mailbox', async () => {
			// GIVEN a conversation that a different mailbox takes part in
			const draft = await startDraft()
			const elsewhere = await insertThreadLinkIn(await insertOtherInbox())

			// WHEN the draft is pointed at it
			const outcome = await callToolExit({
				action: 'update',
				draft_id: draft.draftId,
				thread_link_id: elsewhere,
			})

			// THEN it is refused. Accepted, the draft would report itself
			// attached and then go out as a new conversation, because the send
			// path only answers a conversation its own mailbox is part of
			expect(outcome).toContain('EmailThread')
		})
	})

	describe('when an update names nothing about threading', () => {
		it('should leave what the draft already answers alone', async () => {
			// GIVEN a draft already attached to a conversation
			const draft = await startDraft()
			const threadLinkId = await insertThreadLink()
			await callTool({
				action: 'update',
				draft_id: draft.draftId,
				mode: 'reply',
				thread_link_id: threadLinkId,
			})

			// WHEN something unrelated is changed
			const updated = draftFrom(
				await callTool({
					action: 'update',
					draft_id: draft.draftId,
					subject: 'Quote, revised',
				}),
			)

			// THEN the conversation it answers survives — a key left out means
			// unchanged, and detaching a draft nobody asked to detach would send
			// the next message as a new conversation
			expect(updated.threadLinkId).toBe(threadLinkId)
			expect(updated.subject).toBe('Quote, revised')
		})
	})
})
