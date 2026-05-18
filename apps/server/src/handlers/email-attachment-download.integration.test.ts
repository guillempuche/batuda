// Self-sufficient integration test for the inbound-attachment storage
// contract. The test creates its own org+inbox with synthetic ids, uploads
// bytes to MinIO at the worker's deterministic key shape, and asserts a
// SELECT-then-GET round-trip — i.e. the contract the
// `GET /v1/email/messages/:id/attachments/:idx/download` route is built
// on. The HTTP route itself (auth + content-type header) is exercised
// end-to-end by `apps/internal/tests/e2e/inbound-attachment.test.ts`.
//
// Why we don't rely on the seed: `multi-org-isolation.test.ts` runs
// `TRUNCATE inboxes CASCADE` in its beforeAll, so the seeded
// admin@taller.cat row vanishes between vitest runs. The previous
// version of this test resolved admin@taller.cat at startup and
// failed on the second pre-push. Synthetic fixtures + DELETE-by-id in
// afterAll keep this test independent of seed and other tests.
//
// Prereq: `pnpm cli services up` (Postgres + MinIO).

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const STORAGE_ENDPOINT =
	process.env['STORAGE_ENDPOINT'] ?? 'http://localhost:9000'
const STORAGE_REGION = process.env['STORAGE_REGION'] ?? 'us-east-1'
const STORAGE_ACCESS_KEY_ID = process.env['STORAGE_ACCESS_KEY_ID'] ?? 'batuda'
const STORAGE_SECRET_ACCESS_KEY =
	process.env['STORAGE_SECRET_ACCESS_KEY'] ?? 'batuda-secret'
const STORAGE_BUCKET = process.env['STORAGE_BUCKET'] ?? 'batuda-assets'

const ONE_PIXEL_PNG = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000500010d0a2db40000000049454e44ae426082',
	'hex',
)

const FIXTURE_INBOX_EMAIL = `email-attachment-fixture-${randomUUID()}@taller.test`
const FIXTURE_ORG_ID = `email-attachment-test-org-${randomUUID()}`

describe('email_messages.attachments storage contract', () => {
	let pool: pg.Pool
	let s3: S3Client
	let inboxId: string
	const seededMessageIds: string[] = []
	const seededStorageKeys: string[] = []

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
		s3 = new S3Client({
			endpoint: STORAGE_ENDPOINT,
			region: STORAGE_REGION,
			credentials: {
				accessKeyId: STORAGE_ACCESS_KEY_ID,
				secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
			},
			forcePathStyle: true,
		})

		// `inboxes.organization_id` is `TEXT NOT NULL` with no foreign key,
		// so we can insert a synthetic value without touching the
		// `organization` table that other tests truncate.
		const placeholder = Buffer.from([0])
		const id = randomUUID()
		await pool.query(
			`INSERT INTO inboxes (
				id, organization_id, email, purpose, owner_user_id,
				imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security,
				username, password_ciphertext, password_nonce, password_tag,
				active
			) VALUES (
				$1::uuid, $2, $3, 'human', 'email-attachment-test-user',
				'imap.test', 993, 'tls',
				'smtp.test', 587, 'starttls',
				$3, $4, $4, $4,
				true
			)
			ON CONFLICT DO NOTHING`,
			[id, FIXTURE_ORG_ID, FIXTURE_INBOX_EMAIL, placeholder],
		)
		inboxId = id
	})

	afterAll(async () => {
		for (const messageId of seededMessageIds) {
			await pool.query(`DELETE FROM email_messages WHERE id = $1::uuid`, [
				messageId,
			])
		}
		await pool.query(`DELETE FROM inboxes WHERE email = $1`, [
			FIXTURE_INBOX_EMAIL,
		])
		for (const key of seededStorageKeys) {
			await s3
				.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }))
				.catch(() => undefined)
		}
		await pool.end()
		s3.destroy()
	})

	const seedMessageWithAttachment = async (args: {
		readonly bytes: Buffer
		readonly contentType: string
		readonly filename: string
	}): Promise<{ messageId: string; storageKey: string }> => {
		const messageId = randomUUID()
		seededMessageIds.push(messageId)
		const storageKey = `messages/${FIXTURE_ORG_ID}/${inboxId}/test-${messageId}/attachment-0.bin`
		seededStorageKeys.push(storageKey)

		await s3.send(
			new PutObjectCommand({
				Bucket: STORAGE_BUCKET,
				Key: storageKey,
				Body: args.bytes,
				ContentType: args.contentType,
			}),
		)

		const attachments = JSON.stringify([
			{
				index: 0,
				filename: args.filename,
				contentType: args.contentType,
				sizeBytes: args.bytes.length,
				cid: null,
				isInline: false,
				storageKey,
			},
		])

		await pool.query(
			`INSERT INTO email_messages
			   (id, organization_id, inbox_id, message_id, direction, folder,
			    raw_rfc822_ref, subject, attachments, status)
			 VALUES ($1::uuid, $2, $3::uuid, $4, 'inbound', 'INBOX',
			         'sentinel', 'attachment test', $5::jsonb, 'normal')`,
			[
				messageId,
				FIXTURE_ORG_ID,
				inboxId,
				`<test-${messageId}@example.com>`,
				attachments,
			],
		)
		return { messageId, storageKey }
	}

	describe('when a row carries attachments JSONB pointing at MinIO', () => {
		it('should round-trip the bytes via the storage key', async () => {
			// GIVEN a freshly seeded message + uploaded attachment
			const { messageId } = await seedMessageWithAttachment({
				bytes: ONE_PIXEL_PNG,
				contentType: 'image/png',
				filename: 'pixel.png',
			})

			// WHEN we read the row's storage key and GET from MinIO
			const rows = await pool.query<{ attachments: unknown }>(
				`SELECT attachments FROM email_messages WHERE id = $1::uuid`,
				[messageId],
			)
			expect(rows.rows.length).toBe(1)
			const attachments = rows.rows[0]?.attachments
			expect(Array.isArray(attachments)).toBe(true)
			const meta = (attachments as Array<Record<string, unknown>>)[0]!
			expect(meta['filename']).toBe('pixel.png')
			expect(meta['contentType']).toBe('image/png')
			expect(meta['sizeBytes']).toBe(ONE_PIXEL_PNG.length)

			const got = await s3.send(
				new GetObjectCommand({
					Bucket: STORAGE_BUCKET,
					Key: meta['storageKey'] as string,
				}),
			)
			const bytes = Buffer.from(await got.Body!.transformToByteArray())

			// THEN the bytes round-trip exactly + content-type matches
			expect(bytes.length).toBe(ONE_PIXEL_PNG.length)
			expect(bytes.equals(ONE_PIXEL_PNG)).toBe(true)
			expect(got.ContentType).toBe('image/png')
		})
	})

	describe('when the storage key is missing from MinIO', () => {
		it('should surface a NoSuchKey-style error from the storage layer', async () => {
			// GIVEN a row whose storage_key never had bytes uploaded
			const messageId = randomUUID()
			seededMessageIds.push(messageId)
			const ghostKey = `messages/${FIXTURE_ORG_ID}/${inboxId}/test-${messageId}/attachment-ghost.bin`
			const attachments = JSON.stringify([
				{
					index: 0,
					filename: 'missing.png',
					contentType: 'image/png',
					sizeBytes: 0,
					cid: null,
					isInline: false,
					storageKey: ghostKey,
				},
			])
			await pool.query(
				`INSERT INTO email_messages
				   (id, organization_id, inbox_id, message_id, direction, folder,
				    raw_rfc822_ref, subject, attachments, status)
				 VALUES ($1::uuid, $2, $3::uuid, $4, 'inbound', 'INBOX',
				         'sentinel', 'ghost', $5::jsonb, 'normal')`,
				[
					messageId,
					FIXTURE_ORG_ID,
					inboxId,
					`<ghost-${messageId}@example.com>`,
					attachments,
				],
			)

			// WHEN we GET the missing key
			// THEN MinIO rejects — proves the download endpoint would 404 / 502
			// rather than serve a successful empty response.
			await expect(
				s3.send(
					new GetObjectCommand({
						Bucket: STORAGE_BUCKET,
						Key: ghostKey,
					}),
				),
			).rejects.toThrow()
		})
	})
})
