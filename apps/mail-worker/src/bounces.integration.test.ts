// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the history rows `applyBounce` writes when a message
// we sent comes back undelivered.
//
// Every history row has to say which organization it belongs to. Omitting it
// doesn't just lose the bounce: the write happens inside the transaction that
// stores the bounce notice itself, so the failure discards that too and the
// notice never reaches the inbox. Both shapes are pinned here.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const PAYLOAD = JSON.stringify({
	originalMessageId: '<original@batuda.test>',
	status: '5.1.1',
	diagnostic: 'mailbox unavailable',
	recipients: ['nobody@example.com'],
	bounceType: 'hard',
})

describe('timeline_activity INSERT — bounce contract', () => {
	let pool: pg.Pool
	let orgId: string
	const seededEntityIds: string[] = []

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
		await pool.query('GRANT app_user TO CURRENT_USER')

		const orgs = await pool.query<{ id: string }>(
			`SELECT id FROM organization WHERE slug = $1 LIMIT 1`,
			['taller'],
		)
		const oid = orgs.rows[0]?.id
		if (!oid) {
			throw new Error(
				"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
			)
		}
		orgId = oid
	})

	afterAll(async () => {
		for (const id of seededEntityIds) {
			await pool.query(`DELETE FROM timeline_activity WHERE entity_id = $1`, [
				id,
			])
		}
		await pool.end()
	})

	const withOrgScope = async <T>(
		body: (client: pg.PoolClient) => Promise<T>,
	): Promise<T> => {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			await client.query('SET LOCAL ROLE app_user')
			await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
				orgId,
			])
			const result = await body(client)
			await client.query('COMMIT')
			return result
		} catch (err) {
			await client.query('ROLLBACK')
			throw err
		} finally {
			client.release()
		}
	}

	describe('when the bounce row carries its organization', () => {
		it('should be stored and readable from that organization', async () => {
			// GIVEN the shape applyBounce writes when no contact matched
			// WHEN it runs under that organization's scope
			// THEN the row is stored and readable back
			const entityId = randomUUID()
			seededEntityIds.push(entityId)

			const stored = await withOrgScope(async client => {
				await client.query(
					`INSERT INTO timeline_activity (
						organization_id, kind, entity_type, entity_id,
						channel, direction, occurred_at, payload
					) VALUES (
						$1, 'email_bounced', 'email_message', $2::uuid,
						'email', 'outbound', now(), $3::jsonb
					)`,
					[orgId, entityId, PAYLOAD],
				)
				const result = await client.query<{ kind: string; channel: string }>(
					`SELECT kind, channel FROM timeline_activity WHERE entity_id = $1::uuid`,
					[entityId],
				)
				return result.rows[0]
			})

			expect(stored?.kind).toBe('email_bounced')
			expect(stored?.channel).toBe('email')
		})
	})

	describe('when the bounce row omits its organization', () => {
		it('should be rejected, taking the surrounding write with it', async () => {
			// GIVEN the shape with no organization column in the list
			// WHEN it runs
			// THEN it is refused either way: a scoped session trips the rule
			//      that a row must belong to the reader's organization, and the
			//      worker's own unscoped role trips the column being required.
			//      The refusal matters more than which of the two fires — it
			//      happens inside the same transaction as the bounce notice, so
			//      the notice is discarded with it and never reaches the inbox.
			const entityId = randomUUID()

			await expect(
				withOrgScope(client =>
					client.query(
						`INSERT INTO timeline_activity (
							kind, entity_type, entity_id,
							channel, direction, occurred_at, payload
						) VALUES (
							'email_bounced', 'email_message', $1::uuid,
							'email', 'outbound', now(), $2::jsonb
						)`,
						[entityId, PAYLOAD],
					),
				),
			).rejects.toThrow(/organization_id|row-level security/i)
		})
	})

	describe('when a bounce affects contacts', () => {
		it('should carry the organization onto every contact row it writes', async () => {
			// GIVEN the branch that writes one row per affected contact
			// WHEN it selects those contacts and inserts
			// THEN each row carries the organization, not just the first
			const entityId = randomUUID()
			seededEntityIds.push(entityId)

			const rows = await withOrgScope(async client => {
				const contacts = await client.query<{ id: string }>(
					`SELECT id FROM contacts LIMIT 2`,
				)
				if (contacts.rows.length === 0) {
					throw new Error('seed contacts required — run pnpm cli seed')
				}
				const ids = contacts.rows.map(r => r.id)
				await client.query(
					`INSERT INTO timeline_activity (
						organization_id, kind, entity_type, entity_id, company_id, contact_id,
						channel, direction, occurred_at, payload
					)
					SELECT $1, 'email_bounced', 'email_message', $2::uuid,
					       c.company_id, c.id,
					       'email', 'outbound', now(), $3::jsonb
					FROM contacts c WHERE c.id = ANY($4::uuid[])`,
					[orgId, entityId, PAYLOAD, ids],
				)
				const result = await client.query<{ count: string; orgs: string }>(
					`SELECT count(*)::text AS count,
					        count(DISTINCT organization_id)::text AS orgs
					 FROM timeline_activity WHERE entity_id = $1::uuid`,
					[entityId],
				)
				return result.rows[0]
			})

			expect(Number(rows?.count)).toBeGreaterThan(0)
			expect(rows?.orgs).toBe('1')
		})
	})
})
