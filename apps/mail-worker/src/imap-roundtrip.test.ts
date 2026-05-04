// Live IMAP-roundtrip integration test. Drives Mailpit on
// localhost:1025 (SMTP) / 1143 (IMAP) directly: SMTP-inject a
// message → connect ImapFlow as the seeded admin@taller.cat →
// open INBOX → call `fetchAndIngestNewerThan` against the same
// SqlClient layer the worker uses → assert that an
// `email_messages` row with the test subject lands. The IMAP +
// SMTP connections are real wire interactions; the only thing
// we mock is the `Effect.never` outer loop in
// `runInboxSession` so the test terminates.
//
// Prereq: `pnpm cli services up` (Mailpit + Postgres + MinIO);
// `pnpm cli db reset && pnpm cli seed` so the admin@taller.cat
// inbox + the taller org exist with a working password.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { PgClient } from '@effect/sql-pg'
import { Config, Effect, Redacted } from 'effect'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fetchAndIngestNewerThan, markExpunged } from './folder-sync'
import { RawMessageStorage } from './storage'

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

// Set the worker env so RawMessageStorage.layer succeeds inside the test.
process.env['STORAGE_ENDPOINT'] ??= STORAGE_ENDPOINT
process.env['STORAGE_REGION'] ??= STORAGE_REGION
process.env['STORAGE_ACCESS_KEY_ID'] ??= STORAGE_ACCESS_KEY_ID
process.env['STORAGE_SECRET_ACCESS_KEY'] ??= STORAGE_SECRET_ACCESS_KEY
process.env['STORAGE_BUCKET'] ??= STORAGE_BUCKET
process.env['EMAIL_CREDENTIAL_KEY'] ??=
	'Vt2vKJZS3l6vDmvqEnt5uVmjFPMbWnBOSRiXZWJqwYU='
process.env['EMAIL_WORKER_IDLE_TIMEOUT_SEC'] ??= '60'
process.env['EMAIL_WORKER_BACKFILL_DAYS'] ??= '7'
process.env['EMAIL_WORKER_MAX_CONNECTIONS'] ??= '4'

import { WorkerEnvVars } from './env'

const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

const camelToSnake = (s: string) =>
	s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)

const PgLive = PgClient.layerConfig({
	url: Config.succeed(Redacted.make(DATABASE_URL)),
	transformResultNames: Config.succeed(snakeToCamel),
	transformQueryNames: Config.succeed(camelToSnake),
})

const runWith = <A, E>(eff: Effect.Effect<A, E, never>) =>
	Effect.runPromise(eff)

const smtpInject = async (msg: {
	to: string
	from: string
	subject: string
	text: string
}) => {
	const transport = nodemailer.createTransport({
		host: 'localhost',
		port: 1025,
		secure: false,
		auth: undefined,
	})
	try {
		await transport.sendMail(msg)
	} finally {
		transport.close()
	}
}

const clearMailpit = async () => {
	const res = await fetch('http://localhost:8025/api/v1/messages', {
		method: 'DELETE',
	})
	if (!res.ok) {
		throw new Error(`mailpit clear failed: ${res.status}`)
	}
}

describe('IMAP ingest roundtrip', () => {
	let pool: pg.Pool
	let orgId: string
	let inboxId: string

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
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
		await pool.end()
	})

	const openImap = async () => {
		const client = new ImapFlow({
			host: 'localhost',
			port: 1143,
			secure: false,
			auth: { user: 'admin@taller.cat', pass: 'demo-imap-password' },
			logger: false,
		})
		await client.connect()
		return client
	}

	describe('when an SMTP-injected message arrives and the worker runs one fetch tick', () => {
		it('should INSERT an inbound email_messages row keyed by the IMAP UID', async () => {
			const subject = `roundtrip ${Date.now()}`

			// Clean Mailpit so the only fetched UID is ours.
			await clearMailpit()
			await pool.query(
				`DELETE FROM email_messages WHERE subject = $1 AND organization_id = $2`,
				[subject, orgId],
			)

			// GIVEN an SMTP-injected message addressed to the seeded inbox
			await smtpInject({
				to: 'admin@taller.cat',
				from: 'roundtrip-sender@example.com',
				subject,
				text: 'hello from the roundtrip test',
			})

			// AND a fresh ImapFlow client connected to Mailpit
			const client = await openImap()
			try {
				const opened = await client.mailboxOpen('INBOX')
				const uidvalidity = Number(opened.uidValidity)

				// WHEN we run one fetch tick from sinceUid=0 against our SqlClient
				await runWith(
					fetchAndIngestNewerThan({
						client,
						organizationId: orgId,
						inboxId,
						folder: 'INBOX',
						uidvalidity,
						sinceUid: 0,
					}).pipe(
						Effect.provide(RawMessageStorage.layer),
						Effect.provide(WorkerEnvVars.layer),
						Effect.provide(PgLive),
					),
				)

				// THEN an inbound email_messages row exists with our subject
				const rows = await pool.query<{
					id: string
					direction: string
					imap_uid: number
					imap_uidvalidity: number
				}>(
					`SELECT id, direction, imap_uid, imap_uidvalidity
					 FROM email_messages
					 WHERE subject = $1 AND organization_id = $2`,
					[subject, orgId],
				)
				expect(rows.rows.length).toBe(1)
				expect(rows.rows[0]!.direction).toBe('inbound')
				expect(rows.rows[0]!.imap_uidvalidity).toBe(uidvalidity)
				expect(rows.rows[0]!.imap_uid).toBeGreaterThan(0)
			} finally {
				await client.logout().catch(() => undefined)
			}
		})
	})

	describe('when the same fetch tick runs a second time', () => {
		it('should not duplicate the row (idempotency on the partial unique index)', async () => {
			const subject = `dedupe ${Date.now()}`
			await clearMailpit()
			await pool.query(
				`DELETE FROM email_messages WHERE subject = $1 AND organization_id = $2`,
				[subject, orgId],
			)
			await smtpInject({
				to: 'admin@taller.cat',
				from: 'dedupe-sender@example.com',
				subject,
				text: 'dedupe test',
			})

			const client = await openImap()
			try {
				const opened = await client.mailboxOpen('INBOX')
				const uidvalidity = Number(opened.uidValidity)

				// First tick — INSERT.
				await runWith(
					fetchAndIngestNewerThan({
						client,
						organizationId: orgId,
						inboxId,
						folder: 'INBOX',
						uidvalidity,
						sinceUid: 0,
					}).pipe(
						Effect.provide(RawMessageStorage.layer),
						Effect.provide(WorkerEnvVars.layer),
						Effect.provide(PgLive),
					),
				)

				// Second tick — same UID, must DO NOTHING.
				await runWith(
					fetchAndIngestNewerThan({
						client,
						organizationId: orgId,
						inboxId,
						folder: 'INBOX',
						uidvalidity,
						sinceUid: 0,
					}).pipe(
						Effect.provide(RawMessageStorage.layer),
						Effect.provide(WorkerEnvVars.layer),
						Effect.provide(PgLive),
					),
				)

				const rows = await pool.query<{ count: string }>(
					`SELECT count(*)::text AS count
					 FROM email_messages
					 WHERE subject = $1 AND organization_id = $2`,
					[subject, orgId],
				)
				expect(rows.rows[0]!.count).toBe('1')
			} finally {
				await client.logout().catch(() => undefined)
			}
		})
	})

	describe('when the message is EXPUNGEd from IMAP', () => {
		it('should set deleted_at on the row when markExpunged runs', async () => {
			const subject = `expunge ${Date.now()}`
			await clearMailpit()
			await pool.query(
				`DELETE FROM email_messages WHERE subject = $1 AND organization_id = $2`,
				[subject, orgId],
			)
			await smtpInject({
				to: 'admin@taller.cat',
				from: 'expunge-sender@example.com',
				subject,
				text: 'expunge test',
			})

			const client = await openImap()
			try {
				const opened = await client.mailboxOpen('INBOX')
				const uidvalidity = Number(opened.uidValidity)

				// First, ingest the message so a row exists to soft-delete.
				await runWith(
					fetchAndIngestNewerThan({
						client,
						organizationId: orgId,
						inboxId,
						folder: 'INBOX',
						uidvalidity,
						sinceUid: 0,
					}).pipe(
						Effect.provide(RawMessageStorage.layer),
						Effect.provide(WorkerEnvVars.layer),
						Effect.provide(PgLive),
					),
				)

				// Resolve the UID we just ingested.
				const inserted = await pool.query<{ imap_uid: number }>(
					`SELECT imap_uid FROM email_messages
					 WHERE subject = $1 AND organization_id = $2`,
					[subject, orgId],
				)
				const uid = inserted.rows[0]?.imap_uid
				expect(uid, 'ingested row must have a UID').toBeGreaterThan(0)

				// WHEN markExpunged fires for that UID
				await runWith(
					markExpunged({
						inboxId,
						imapUidvalidity: uidvalidity,
						imapUid: uid!,
					}).pipe(Effect.provide(PgLive)),
				)

				// THEN the row's deleted_at is non-NULL
				const after = await pool.query<{ deleted_at: Date | null }>(
					`SELECT deleted_at FROM email_messages
					 WHERE subject = $1 AND organization_id = $2`,
					[subject, orgId],
				)
				expect(after.rows[0]?.deleted_at).not.toBeNull()
			} finally {
				await client.logout().catch(() => undefined)
			}
		})
	})
})
