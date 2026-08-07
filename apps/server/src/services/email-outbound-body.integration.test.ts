// What we sent has to be readable afterwards. The wire bytes go to object
// storage and everything else only exists in the recipient's mailbox, so if the
// send path does not write the body to the message row, the thread shows an
// empty card and nothing anywhere can fill it back in.

// PgLive reads DATABASE_URL at layer-build time (no default). Set it so the
// suite runs without a loaded .env, matching the other integration tests.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Effect, Layer } from 'effect'
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

const ORG = 'outbound-body-test-org'
const USER = 'outbound-body-user'
const SENT_MESSAGE_ID = '<outbound-body-test@taller.test>'

const stubCrypto = Layer.succeed(CredentialCrypto, {
	encryptPassword: () => ({
		ciphertext: new Uint8Array([0]),
		nonce: new Uint8Array([0]),
		tag: new Uint8Array([0]),
	}),
	decryptPassword: () => 'stubbed-password',
} as never)

// Accepts the message and hands back a Message-ID the way SMTP does, so the
// row under test is keyed the same way production keys it.
const stubTransport = Layer.succeed(MailTransport, {
	probe: () => Effect.void,
	send: () =>
		Effect.succeed({
			messageId: SENT_MESSAGE_ID,
			raw: new Uint8Array([0]),
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
		name: 'Outbound Body Test',
		slug: 'outbound-body-test',
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
const run = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		EmailService | SqlClient.SqlClient | CurrentOrg | SessionContext
	>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: {
					id: ORG,
					name: 'Outbound Body Test',
					slug: 'outbound-body-test',
				} as never,
				userId: USER,
				role: 'owner',
			})(effect.pipe(Effect.provide(serviceLayer), Effect.provide(actingAs)))
		}).pipe(Effect.provide(PgLive)),
	)

const placeholder = new Uint8Array([0])

const sqlOnly = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(PgLive)))

let inboxId = ''
let companyId = ''

const storedMessage = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{
				direction: string
				textBody: string | null
				htmlBody: string | null
				textPreview: string | null
			}>`
				SELECT direction, text_body, html_body, text_preview
				FROM email_messages
				WHERE organization_id = ${ORG} AND message_id = ${SENT_MESSAGE_ID}
			`
			return rows[0]
		}),
	)

beforeAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			// Better Auth owns this table, so its columns are camelCase.
			yield* sql`
				INSERT INTO organization (id, name, slug, "createdAt")
				VALUES (${ORG}, 'Outbound Body Test', 'outbound-body-test', now())
				ON CONFLICT (id) DO NOTHING
			`
			const companies = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, name, slug)
				VALUES (${ORG}, 'Recipient Co', 'recipient-co')
				ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
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
		}),
	)
})

// A conversation already under way, so replying has something to answer.
// Written straight to the database: how it got there is not what is under test.
const PARENT_MESSAGE_ID = '<outbound-body-parent@client.test>'

const seedThreadToReplyTo = () =>
	sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const links = yield* sql<{ id: string }>`
				INSERT INTO email_thread_links (
					organization_id, inbox_id, external_thread_id, company_id, subject, status
				) VALUES (
					${ORG}, ${inboxId}, ${PARENT_MESSAGE_ID}, ${companyId},
					'Quote for the booking module', 'open'
				)
				RETURNING id
			`
			yield* sql`
				INSERT INTO email_messages (
					organization_id, inbox_id, folder, message_id, "references",
					subject, received_at, recipients, attachments,
					status, status_updated_at, direction, raw_rfc822_ref
				) VALUES (
					${ORG}, ${inboxId}, 'INBOX', ${PARENT_MESSAGE_ID}, ${[] as string[]},
					'Quote for the booking module', now(),
					${JSON.stringify({ to: ['client@example.com'], cc: [], bcc: [] })}::jsonb,
					'[]'::jsonb, 'normal', now(), 'inbound', 'sentinel'
				)
			`
			return links[0]!.id
		}),
	)

beforeEach(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM email_messages WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${ORG}`
		}),
	)
})

afterAll(async () => {
	await sqlOnly(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM email_messages WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM email_thread_links WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM inboxes WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM companies WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM organization WHERE id = ${ORG}`
		}),
	)
})

describe('EmailService.send', () => {
	describe('when a message is sent', () => {
		it('should store what the recipient was sent, so the thread can be read back', async () => {
			// GIVEN a message with a sentence someone will want to re-read
			// WHEN it is sent
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.send(
						inboxId,
						'client@example.com',
						'Quote for the booking module',
						[
							{
								type: 'paragraph',
								spans: [{ kind: 'text', value: 'The quote is attached.' }],
							},
						],
						companyId,
					)
				}),
			)

			// THEN the row carries the body in both forms, and a summary line
			const stored = await storedMessage()
			expect(stored?.direction).toBe('outbound')
			expect(stored?.textBody).toContain('The quote is attached.')
			expect(stored?.htmlBody).toContain('The quote is attached.')
			expect(stored?.textPreview).toContain('The quote is attached.')
		})

		it('should cut the summary to the same length arriving mail uses', async () => {
			// GIVEN a body longer than the 200-character summary
			// [persist.ts — inbound uses text.slice(0, 200)]
			const long = 'x'.repeat(500)

			// WHEN it is sent
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.send(
						inboxId,
						'client@example.com',
						'Long one',
						[{ type: 'paragraph', spans: [{ kind: 'text', value: long }] }],
						companyId,
					)
				}),
			)

			// THEN the stored summary stops at 200 characters while the body keeps
			// everything
			const stored = await storedMessage()
			expect(stored?.textPreview).toHaveLength(200)
			expect(stored?.textBody).toContain(long)
		})
	})
})

// Replying is the commonest way a message goes out, and a draft is what the
// compose form sends. Each writes the row through its own call, so a body kept
// on one says nothing about the others.

describe('EmailService.reply', () => {
	describe('when a reply is sent', () => {
		it('should store what the recipient was sent', async () => {
			// GIVEN a thread already carrying a message to reply to
			const threadId = await seedThreadToReplyTo()

			// WHEN a reply goes out on it
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.reply(threadId, [
						{
							type: 'paragraph',
							spans: [{ kind: 'text', value: 'Sending the revised figure.' }],
						},
					])
				}),
			)

			// THEN the reply is readable afterwards, not an empty card
			const stored = await storedMessage()
			expect(stored?.direction).toBe('outbound')
			expect(stored?.textBody).toContain('Sending the revised figure.')
			expect(stored?.htmlBody).toContain('Sending the revised figure.')
			expect(stored?.textPreview).toContain('Sending the revised figure.')
		})
	})
})

describe('EmailService.sendDraft', () => {
	describe('when a saved draft is sent', () => {
		it('should store what the recipient was sent', async () => {
			// GIVEN a draft someone wrote and saved
			const draftId = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					const draft = yield* svc.createDraft(
						inboxId,
						{
							to: ['client@example.com'],
							subject: 'From a draft',
							bodyJson: [
								{
									type: 'paragraph',
									spans: [
										{ kind: 'text', value: 'Written earlier, sent now.' },
									],
								},
							],
						},
						{ companyId },
					)
					return draft.draftId
				}),
			)

			// WHEN it is sent
			await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.sendDraft(inboxId, draftId)
				}),
			)

			// THEN the sent draft is readable afterwards
			const stored = await storedMessage()
			expect(stored?.direction).toBe('outbound')
			expect(stored?.textBody).toContain('Written earlier, sent now.')
			expect(stored?.htmlBody).toContain('Written earlier, sent now.')
		})
	})
})
