// Pins how the record of "which tool last used this key or connection" is
// written: the last-used stamp belongs to connections only, a colleague using
// the same assistant gets their own row, a chatty assistant does not write on
// every call, and a write can only land in the organization the request is
// acting in.

import { randomUUID } from 'node:crypto'

import type { PgClient } from '@effect/sql-pg'
import { type Config, Effect, ManagedRuntime } from 'effect'
import { SqlClient, type SqlError } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { enterOrgScope } from '../middleware/org'
import { applyTestEnv } from '../test-env'
import { recordClientSeen } from './client-seen'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const PRINCIPAL_PREFIX = `client-seen-${randomUUID()}`

type Org = { id: string; name: string; slug: string }

let pool: pg.Pool
let runtime: ManagedRuntime.ManagedRuntime<
	SqlClient.SqlClient | PgClient.PgClient,
	Config.ConfigError | SqlError.SqlError
>
let taller: Org
let restaurant: Org

const orgBySlug = async (slug: string): Promise<Org> => {
	const result = await pool.query<Org>(
		'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
		[slug],
	)
	const row = result.rows[0]
	if (!row)
		throw new Error(
			`${slug} org missing — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return row
}

// Write the record the way a request does: inside the organization's scope, so
// the database applies the same check it applies in production.
const record = (
	org: Org,
	opts: {
		readonly principalKind: 'api_key' | 'oauth'
		readonly principalId: string
		readonly userId: string
		readonly client?: { name: string | null; version: string | null } | null
		readonly userAgent?: string | null
	},
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: opts.userId })(
				recordClientSeen(sql, {
					orgId: org.id,
					principalKind: opts.principalKind,
					principalId: opts.principalId,
					userId: opts.userId,
					client: opts.client ?? null,
					userAgent: opts.userAgent ?? null,
				}),
			)
		}),
	)

type SeenRow = {
	organization_id: string
	principal_kind: string
	principal_id: string
	user_id: string
	client_name: string | null
	client_version: string | null
	user_agent: string | null
	last_seen_at: Date | null
}

const readSeen = async (principalId: string) => {
	const rows = await pool.query<SeenRow>(
		`SELECT * FROM mcp_client_seen WHERE principal_id = $1 ORDER BY user_id`,
		[principalId],
	)
	return rows.rows
}

const principal = (label: string) => `${PRINCIPAL_PREFIX}-${label}`

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	taller = await orgBySlug('taller')
	restaurant = await orgBySlug('restaurant')
	runtime = ManagedRuntime.make(PgLive)
})

afterEach(async () => {
	await pool.query('DELETE FROM mcp_client_seen WHERE principal_id LIKE $1', [
		`${PRINCIPAL_PREFIX}%`,
	])
})

afterAll(async () => {
	await pool.query('DELETE FROM mcp_client_seen WHERE principal_id LIKE $1', [
		`${PRINCIPAL_PREFIX}%`,
	])
	await runtime.dispose()
	await pool.end()
})

describe('recordClientSeen', () => {
	describe('when an API key is used', () => {
		it('should record the tool but leave the last-used stamp empty', async () => {
			// GIVEN a key whose tool announced itself
			const id = principal('key')

			// WHEN the use is recorded
			await record(taller, {
				principalKind: 'api_key',
				principalId: id,
				userId: 'user-a',
				client: { name: 'claude-code', version: '2.0.1' },
				userAgent: 'claude-code/2.0.1',
			})

			// THEN the tool is stored, and no stamp — a key already carries its
			// own last-used time, and a second clock would drift from it
			const rows = await readSeen(id)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				client_name: 'claude-code',
				client_version: '2.0.1',
				user_agent: 'claude-code/2.0.1',
				last_seen_at: null,
			})
		})
	})

	describe('when an OAuth connection is used', () => {
		it('should stamp the last-used time', async () => {
			// GIVEN a connection being used
			const id = principal('oauth')

			// WHEN the use is recorded
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
				client: { name: 'ChatGPT', version: null },
			})

			// THEN it carries a stamp, because nothing else records one for a
			// connection
			const rows = await readSeen(id)
			expect(rows[0]?.last_seen_at).toBeInstanceOf(Date)
		})

		it('should give each person their own row for a shared client', async () => {
			// GIVEN two colleagues connecting the same assistant, which registers
			// once and is therefore one client id for both of them
			const id = principal('shared')
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
				client: { name: 'ChatGPT', version: null },
			})
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-b',
				client: { name: 'ChatGPT', version: null },
			})

			// THEN neither overwrites the other
			const rows = await readSeen(id)
			expect(rows.map(r => r.user_id)).toEqual(['user-a', 'user-b'])
		})
	})

	describe('when the same connection keeps calling', () => {
		it('should not move the stamp again within the minute', async () => {
			// GIVEN a connection that has just been recorded
			const id = principal('chatty')
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
			})
			const first = (await readSeen(id))[0]?.last_seen_at

			// WHEN it calls again straight away
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
			})

			// THEN the stamp is untouched — a busy assistant would otherwise write
			// on every single call for a precision no page shows
			expect((await readSeen(id))[0]?.last_seen_at).toEqual(first)
		})

		it('should move the stamp once the minute has passed', async () => {
			// GIVEN a connection last seen well over a minute ago
			const id = principal('stale')
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
			})
			await pool.query(
				`UPDATE mcp_client_seen SET last_seen_at = now() - interval '5 minutes'
				 WHERE principal_id = $1`,
				[id],
			)

			// WHEN it calls again
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
			})

			// THEN the stamp catches up
			const seen = (await readSeen(id))[0]?.last_seen_at
			expect(seen && Date.now() - seen.getTime()).toBeLessThan(60_000)
		})
	})

	describe('when a later call carries no tool details', () => {
		it('should keep the tool recorded earlier', async () => {
			// GIVEN a connection whose opening handshake named the tool
			const id = principal('keeps')
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
				client: { name: 'Cursor', version: '1.2' },
				userAgent: 'cursor/1.2',
			})

			// WHEN an ordinary call follows, which carries no handshake
			await record(taller, {
				principalKind: 'oauth',
				principalId: id,
				userId: 'user-a',
				client: null,
				userAgent: 'cursor/1.2',
			})

			// THEN the tool is still known — only the handshake names it, and it
			// is sent once per session
			expect((await readSeen(id))[0]).toMatchObject({
				client_name: 'Cursor',
				client_version: '1.2',
			})
		})
	})

	describe('when the same key is used from a different tool', () => {
		it('should follow the tool that used it last', async () => {
			// GIVEN a key last used from one tool
			const id = principal('changes')
			await record(taller, {
				principalKind: 'api_key',
				principalId: id,
				userId: 'user-a',
				client: { name: 'Cursor', version: '1.2' },
			})

			// WHEN the same key is used from another
			await record(taller, {
				principalKind: 'api_key',
				principalId: id,
				userId: 'user-a',
				client: { name: 'claude-code', version: '2.0' },
			})

			// THEN the record names the tool it was last used from
			expect((await readSeen(id))[0]).toMatchObject({
				client_name: 'claude-code',
				client_version: '2.0',
			})
		})
	})

	describe('when two organizations use the same key id', () => {
		it('should keep the records apart', async () => {
			// GIVEN the same principal id recorded while acting in each org
			const id = principal('cross-org')
			await record(taller, {
				principalKind: 'api_key',
				principalId: id,
				userId: 'user-a',
				client: { name: 'from-taller', version: null },
			})
			await record(restaurant, {
				principalKind: 'api_key',
				principalId: id,
				userId: 'user-a',
				client: { name: 'from-restaurant', version: null },
			})

			// THEN each organization has its own row rather than one overwriting
			// the other
			const rows = await readSeen(id)
			expect(rows).toHaveLength(2)
			expect(rows.map(r => [r.organization_id, r.client_name]).sort()).toEqual(
				[
					[taller.id, 'from-taller'],
					[restaurant.id, 'from-restaurant'],
				].sort(),
			)
		})
	})
})
