// Live-DB + live-MinIO test for the inbound-attachment download path.
// We INSERT a fresh inbox + email_messages row with a populated
// attachments JSONB pointing at a sibling MinIO key, write the bytes
// directly via the AWS SDK so the test does not depend on the worker
// having ingested anything, then fetch the endpoint and assert the
// response equals the bytes.
//
// Prereq: `pnpm cli services up` so Postgres + MinIO are reachable;
// `pnpm cli db reset` so the schema has the attachments JSONB column.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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

const SERVER_URL = process.env['E2E_API_URL'] ?? 'http://localhost:4657'

const ONE_PIXEL_PNG = Buffer.from(
	'89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000500010d0a2db40000000049454e44ae426082',
	'hex',
)

describe('GET /v1/email/messages/:id/attachments/:attachmentId/download', () => {
	let pool: pg.Pool
	let s3: S3Client
	let orgId: string
	let inboxId: string
	const seededIds: string[] = []

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

		// Use the seeded taller org so the API server's Better Auth pipeline
		// resolves a valid org context — the route is RLS-scoped and
		// requires CurrentOrg.
		const orgs = await pool.query<{ id: string }>(
			`SELECT id FROM organization WHERE slug = 'taller' LIMIT 1`,
		)
		const oid = orgs.rows[0]?.id
		if (!oid) {
			throw new Error(
				"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
			)
		}
		orgId = oid

		const inboxes = await pool.query<{ id: string }>(
			`SELECT id FROM inboxes WHERE email = 'admin@taller.cat' LIMIT 1`,
		)
		const iid = inboxes.rows[0]?.id
		if (!iid) {
			throw new Error(
				"admin@taller.cat inbox missing — run 'pnpm cli db reset && pnpm cli seed' first",
			)
		}
		inboxId = iid
	})

	afterAll(async () => {
		for (const id of seededIds) {
			await pool.query(`DELETE FROM email_messages WHERE id = $1::uuid`, [id])
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
		seededIds.push(messageId)
		const storageKey = `messages/${orgId}/${inboxId}/test-${messageId}/attachment-0.bin`

		// Upload the bytes first; the row's JSONB references this key.
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
				orgId,
				inboxId,
				`<test-${messageId}@example.com>`,
				attachments,
			],
		)
		return { messageId, storageKey }
	}

	describe('when the message has a populated attachments JSONB', () => {
		it('should stream the bytes from MinIO with the right Content-Type', async () => {
			// GIVEN a freshly seeded message with one attachment
			const { messageId } = await seedMessageWithAttachment({
				bytes: ONE_PIXEL_PNG,
				contentType: 'image/png',
				filename: 'pixel.png',
			})

			// WHEN we hit the download endpoint
			const url = `${SERVER_URL}/v1/email/messages/${messageId}/attachments/0/download`
			const res = await fetch(url, { credentials: 'include' })

			// THEN the response carries the attachment bytes verbatim and
			// the Content-Type from the JSONB metadata.
			expect(res.ok, `expected 200, got ${res.status}`).toBe(true)
			const got = Buffer.from(await res.arrayBuffer())
			expect(got.length).toBe(ONE_PIXEL_PNG.length)
			expect(got.equals(ONE_PIXEL_PNG)).toBe(true)
			expect(res.headers.get('content-type')?.toLowerCase()).toContain(
				'image/png',
			)
		})
	})
})
