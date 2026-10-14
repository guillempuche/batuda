// A file sent with a message has to show on the conversation afterwards, and
// count it under "has attachments", the same as a file that arrived. The
// recipient gets the file either way; what is at stake is whether anybody here
// can see that it went.

// PgLive reads DATABASE_URL at layer-build time (no default). Set it so the
// suite runs without a loaded .env, matching the other integration tests.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
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

const ORG = 'outbound-attachments-test-org'
const USER = 'outbound-attachments-user'
const SENT_MESSAGE_ID = '<outbound-attachments-test@taller.test>'

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

// Remembers what was handed to it, so a test can tell which files were kept.
// A key listed in `refuse` fails the way an unreachable bucket would.
const stored = new Map<string, Uint8Array>()
const refuse = new Set<string>()
const stubStorage = Layer.succeed(StorageProvider, {
	put: ({ key, body }: { key: string; body: Uint8Array }) =>
		Effect.suspend(() => {
			if ([...refuse].some(suffix => key.endsWith(suffix))) {
				return Effect.fail(new Error('storage unreachable'))
			}
			stored.set(key, body)
			return Effect.void
		}),
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
		name: 'Outbound Attachments Test',
		slug: 'outbound-attachments-test',
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
					name: 'Outbound Attachments Test',
					slug: 'outbound-attachments-test',
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
				attachments: ReadonlyArray<{
					index: number
					filename: string
					contentType: string
					sizeBytes: number
					cid: string | null
					isInline: boolean
					storageKey: string
				}>
				rawRfc822Ref: string
			}>`
				SELECT attachments, raw_rfc822_ref
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
				VALUES (${ORG}, 'Outbound Attachments Test', 'outbound-attachments-test', now())
				ON CONFLICT (id) DO NOTHING
			`
			const companies = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, name, slug)
				VALUES (${ORG}, 'Recipient Co', 'recipient-co')
				-- The predicate is repeated because the company name is unique only
				-- among the ones still in use.
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
		}),
	)
})

beforeEach(async () => {
	stored.clear()
	refuse.clear()
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

const QUOTE_PDF = Buffer.from('%PDF-1.4 quote')
const LOGO_PNG = Buffer.from('png-bytes')

const sendWith = (
	attachments: ReadonlyArray<{
		filename: string
		contentType: string
		bytes: Buffer
		disposition: 'inline' | 'attachment'
		contentId?: string
	}>,
) =>
	run(
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
				undefined,
				{
					actor: null,
					rawAttachments: attachments.map(a => ({
						filename: a.filename,
						contentType: a.contentType,
						contentBase64: a.bytes.toString('base64'),
						disposition: a.disposition,
						...(a.contentId !== undefined && { contentId: a.contentId }),
					})),
				},
			)
		}),
	)

describe('EmailService.send', () => {
	describe('when a message goes out with files', () => {
		it('should list each file on the stored message, the way arriving mail lists them', async () => {
			// GIVEN a quote attached as a file and a logo shown inside the body
			// WHEN the message is sent
			await sendWith([
				{
					filename: 'quote.pdf',
					contentType: 'application/pdf',
					bytes: QUOTE_PDF,
					disposition: 'attachment',
				},
				{
					filename: 'logo.png',
					contentType: 'image/png',
					bytes: LOGO_PNG,
					disposition: 'inline',
					contentId: 'logo@batuda',
				},
			])

			// THEN the row names both, each kept beside the message's own copy
			const row = await storedMessage()
			const base = row!.rawRfc822Ref.replace(/\.eml$/, '')
			expect(row?.attachments).toEqual([
				{
					index: 0,
					filename: 'quote.pdf',
					contentType: 'application/pdf',
					sizeBytes: QUOTE_PDF.byteLength,
					cid: null,
					isInline: false,
					storageKey: `${base}/attachment-0.bin`,
				},
				{
					index: 1,
					filename: 'logo.png',
					contentType: 'image/png',
					sizeBytes: LOGO_PNG.byteLength,
					cid: 'logo@batuda',
					isInline: true,
					storageKey: `${base}/attachment-1.bin`,
				},
			])
			// AND the bytes stored are the ones that were sent, so a download
			// serves the real file
			expect(
				Buffer.from(stored.get(`${base}/attachment-0.bin`)!).equals(QUOTE_PDF),
			).toBe(true)
		})

		it('should count the conversation under "has attachments"', async () => {
			// GIVEN a message sent with a file
			await sendWith([
				{
					filename: 'quote.pdf',
					contentType: 'application/pdf',
					bytes: QUOTE_PDF,
					disposition: 'attachment',
				},
			])

			// WHEN the conversations with attachments are listed
			const page = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.listThreads({ hasAttachments: true })
				}),
			)

			// THEN the one just sent is among them
			expect(page.items.map(t => t.subject)).toContain(
				'Quote for the booking module',
			)
		})

		it('should not count a conversation whose only file sits inside the body', async () => {
			// GIVEN a message whose one image is shown inline
			await sendWith([
				{
					filename: 'logo.png',
					contentType: 'image/png',
					bytes: LOGO_PNG,
					disposition: 'inline',
					contentId: 'logo@batuda',
				},
			])

			// WHEN the conversations with attachments are listed
			const page = await run(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.listThreads({ hasAttachments: true })
				}),
			)

			// THEN it is not among them, matching how arriving mail is counted
			expect(page.items).toHaveLength(0)
		})
	})

	describe('when a file cannot be kept', () => {
		it('should still record the message, listing only the files that were kept', async () => {
			// GIVEN storage that refuses the first file but takes the second
			refuse.add('/attachment-0.bin')

			// WHEN a message with both is sent
			await sendWith([
				{
					filename: 'lost.pdf',
					contentType: 'application/pdf',
					bytes: QUOTE_PDF,
					disposition: 'attachment',
				},
				{
					filename: 'kept.pdf',
					contentType: 'application/pdf',
					bytes: QUOTE_PDF,
					disposition: 'attachment',
				},
			])

			// THEN the message is stored, and the list holds the kept file at the
			// first place, since a download finds a file by its place in the list
			const row = await storedMessage()
			expect(row?.attachments.map(a => [a.index, a.filename])).toEqual([
				[0, 'kept.pdf'],
			])
		})
	})

	describe('when a message goes out with no files', () => {
		it('should store an empty list, leaving the Sent folder free to fill it', async () => {
			// GIVEN a message with nothing attached
			// WHEN it is sent
			await sendWith([])

			// THEN the list is empty rather than missing
			const row = await storedMessage()
			expect(row?.attachments).toEqual([])
		})
	})
})
