// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the calendar_events INSERT that
// `apps/server/src/handlers/calendar.ts` runs from
// `handle('createInternalEvent', ...)`. The MCP tool path
// (create_internal_block → CalendarService.createInternalBlock) already
// stamps organization_id from CurrentOrg, so it's not in scope here —
// only the HTTP handler bypassed the service and wrote SQL directly.
//
// Mirrors the post-fix shape (organization_id stamped from CurrentOrg)
// using raw `pg` with `app.current_org_id` set on the session, so the
// org_isolation_calendar_events RLS policy engages exactly as it does
// at runtime. Also pins the pre-fix shape as a failure case so a future
// hand-edit that drops the column from the INSERT immediately fails
// the suite.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('calendar_events INSERT — RLS contract (internal events)', () => {
	let pool: pg.Pool
	let orgId: string
	const seededEventIds: string[] = []

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
		for (const id of seededEventIds) {
			await pool.query(`DELETE FROM calendar_events WHERE id = $1::uuid`, [id])
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

	describe('when the createInternalEvent INSERT includes organization_id', () => {
		it('should pass the org_isolation_calendar_events WITH CHECK clause as app_user', async () => {
			// GIVEN app.current_org_id = taller.id and SET ROLE app_user
			// WHEN INSERT INTO calendar_events runs with organization_id=taller.id
			//      (mirrors handlers/calendar.ts createInternalEvent post-fix shape)
			// THEN the policy approves the row
			// [handlers/calendar.ts — createInternalEvent INSERT shape]
			const id = randomUUID()
			seededEventIds.push(id)
			const icalUid = `internal-${randomUUID()}@calendar.batuda`

			const inserted = await withOrgScope(async client => {
				const result = await client.query<{
					id: string
					organization_id: string
					source: string
				}>(
					`INSERT INTO calendar_events (
						id,
						organization_id,
						source, provider, ical_uid, ical_sequence,
						start_at, end_at, status,
						title, location_type, organizer_email
					) VALUES (
						$1::uuid,
						$2,
						'internal', 'internal', $3, 0,
						now(), now() + interval '30 minutes', 'confirmed',
						'Test Block', 'none', 'organizer@example.com'
					)
					RETURNING id, organization_id, source`,
					[id, orgId, icalUid],
				)
				return result.rows[0]
			})

			expect(inserted?.id).toBe(id)
			expect(inserted?.organization_id).toBe(orgId)
			expect(inserted?.source).toBe('internal')
		})
	})

	describe('when the INSERT omits organization_id (the pre-fix shape)', () => {
		it('should fail because the column is NOT NULL', async () => {
			// GIVEN the pre-fix INSERT — no organization_id column in the list
			// WHEN it runs as app_user with app.current_org_id set
			// THEN the INSERT fails because organization_id is NOT NULL with no default
			// [handlers/calendar.ts (pre-fix) — createInternalEvent omitted org_id]
			const id = randomUUID()
			const icalUid = `internal-${randomUUID()}@calendar.batuda`

			await expect(
				withOrgScope(async client => {
					await client.query(
						`INSERT INTO calendar_events (
							id,
							source, provider, ical_uid, ical_sequence,
							start_at, end_at, status,
							title, location_type, organizer_email
						) VALUES (
							$1::uuid,
							'internal', 'internal', $2, 0,
							now(), now() + interval '30 minutes', 'confirmed',
							'Bug Repro', 'none', 'organizer@example.com'
						)`,
						[id, icalUid],
					)
				}),
			).rejects.toThrow(
				/null value in column "organization_id"|row.level security/i,
			)
		})
	})
})
