// Live-DB unit test for the JWZ-simplified threading resolver. Builds
// fixture rows directly via raw pg (the worker's Effect SQL layer is
// over-engineered for fixture inserts), then runs `resolveThreadId`
// through Effect.runPromise with a SqlClient layered onto the same
// connection. Each scenario uses a fresh org id so cross-tests don't
// share rows; cleanup is via DELETE in `afterAll`.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on
// $DATABASE_URL, and `pnpm cli db reset` so the schema is current.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { PgClient } from '@effect/sql-pg'
import { Config, Effect, Redacted } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveThreadId } from './threading'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

const camelToSnake = (s: string) =>
	s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)

const PgLive = PgClient.layerConfig({
	url: Config.succeed(Redacted.make(DATABASE_URL)),
	transformResultNames: Config.succeed(snakeToCamel),
	transformQueryNames: Config.succeed(camelToSnake),
})

const runWithSql = <A, E>(eff: Effect.Effect<A, E, never>) =>
	Effect.runPromise(eff)

describe('resolveThreadId', () => {
	let pool: pg.Pool
	const seededOrgIds: string[] = []

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	})

	afterAll(async () => {
		for (const oid of seededOrgIds) {
			await pool.query(
				`DELETE FROM email_messages WHERE organization_id = $1`,
				[oid],
			)
			await pool.query(
				`DELETE FROM email_thread_links WHERE organization_id = $1`,
				[oid],
			)
		}
		await pool.end()
	})

	const freshOrg = (): string => {
		const oid = `test-org-${randomUUID()}`
		seededOrgIds.push(oid)
		return oid
	}

	const insertParent = async (
		orgId: string,
		opts: {
			readonly messageId: string
			readonly externalThreadId: string
			readonly references?: readonly string[]
		},
	) => {
		// Both rows live under the same org so the JOIN in resolveThreadId
		// finds them. raw_rfc822_ref carries a sentinel — the threading
		// query never reads object storage.
		await pool.query(
			`INSERT INTO email_thread_links (organization_id, external_thread_id, subject)
			 VALUES ($1, $2, 'parent') ON CONFLICT DO NOTHING`,
			[orgId, opts.externalThreadId],
		)
		await pool.query(
			`INSERT INTO email_messages
			   (organization_id, message_id, "references",
			    direction, folder, raw_rfc822_ref, status)
			 VALUES ($1, $2, $3,
			         'inbound', 'INBOX', 'sentinel', 'normal')`,
			[orgId, opts.messageId, opts.references ?? []],
		)
	}

	describe('when the org has no prior messages', () => {
		it('should return the messageId as the new thread root', async () => {
			// GIVEN a fresh org with zero rows
			// WHEN a brand-new message arrives
			// THEN external_thread_id = the new message_id (root)
			// [threading.ts:65 — return args.messageId]
			const orgId = freshOrg()
			const result = await runWithSql(
				resolveThreadId({
					organizationId: orgId,
					messageId: '<root@example.com>',
					inReplyTo: null,
					references: [],
				}).pipe(Effect.provide(PgLive)),
			)
			expect(result).toBe('<root@example.com>')
		})
	})

	describe('when in_reply_to matches a known message', () => {
		it('should reuse that message’s external_thread_id', async () => {
			// GIVEN a stored parent <a@x> with thread <a@x>
			// WHEN a new message arrives with inReplyTo=<a@x>
			// THEN the resolver returns <a@x>
			// [threading.ts:26-42 — in-reply-to branch]
			const orgId = freshOrg()
			await insertParent(orgId, {
				messageId: '<a@x>',
				externalThreadId: '<a@x>',
			})
			const result = await runWithSql(
				resolveThreadId({
					organizationId: orgId,
					messageId: '<b@x>',
					inReplyTo: '<a@x>',
					references: ['<a@x>'],
				}).pipe(Effect.provide(PgLive)),
			)
			expect(result).toBe('<a@x>')
		})
	})

	describe('when in_reply_to is unknown but references include a known ancestor', () => {
		it('should return the ancestor’s external_thread_id', async () => {
			// GIVEN parent <root@x> with thread <root@x>
			// WHEN a new message has inReplyTo=<unknown> but references
			//      includes <root@x>
			// THEN the references-walk finds the ancestor
			// [threading.ts:46-63 — references-walk branch]
			const orgId = freshOrg()
			await insertParent(orgId, {
				messageId: '<root@x>',
				externalThreadId: '<root@x>',
			})
			const result = await runWithSql(
				resolveThreadId({
					organizationId: orgId,
					messageId: '<late@x>',
					inReplyTo: '<lost@x>',
					references: ['<root@x>', '<missing@x>'],
				}).pipe(Effect.provide(PgLive)),
			)
			expect(result).toBe('<root@x>')
		})
	})

	describe('when references list contains multiple known ancestors', () => {
		it('should prefer the newest (last in the array) — reverse-iteration', async () => {
			// GIVEN two stored messages, each anchoring its own thread
			// WHEN a new message references both, oldest-first
			// THEN the resolver picks the newest (last entry walked first)
			// [threading.ts:46 — reverse() the array]
			const orgId = freshOrg()
			await insertParent(orgId, {
				messageId: '<old@x>',
				externalThreadId: '<old@x>',
			})
			await insertParent(orgId, {
				messageId: '<new@x>',
				externalThreadId: '<new@x>',
			})
			const result = await runWithSql(
				resolveThreadId({
					organizationId: orgId,
					messageId: '<latest@x>',
					inReplyTo: null,
					references: ['<old@x>', '<new@x>'],
				}).pipe(Effect.provide(PgLive)),
			)
			expect(result).toBe('<new@x>')
		})
	})
})
