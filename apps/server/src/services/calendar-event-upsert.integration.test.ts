// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the calendar_events upsert that
// `apps/server/src/services/calendar.ts` runs when a booking arrives from
// cal.com and when an invitation arrives by email.
//
// An invitation carries an id (`ical_uid`) that is only unique per
// organization, so the same invitation can legitimately reach two of them.
// The table enforces that with a two-column unique index, and an upsert has
// to name both columns for Postgres to accept it. Naming only `ical_uid`
// fails every write — which is why the broken shape is pinned here too.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('calendar_events upsert — conflict-target contract', () => {
	let pool: pg.Pool
	let orgId: string
	const seededIcalUids: string[] = []

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
		for (const uid of seededIcalUids) {
			await pool.query(`DELETE FROM calendar_events WHERE ical_uid = $1`, [uid])
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

	const upsert = (
		client: pg.PoolClient,
		conflictTarget: string,
		values: {
			readonly icalUid: string
			readonly sequence: number
			readonly title: string
		},
	) =>
		client.query(
			`INSERT INTO calendar_events (
				organization_id, source, provider, provider_booking_id,
				ical_uid, ical_sequence, start_at, end_at, status,
				title, location_type, organizer_email
			) VALUES (
				$1, 'booking', 'calcom', 'bk-' || $2,
				$2, $3, now(), now() + interval '30 minutes', 'confirmed',
				$4, 'video', 'organizer@taller.cat'
			)
			ON CONFLICT (${conflictTarget}) DO UPDATE SET
				title = EXCLUDED.title,
				ical_sequence = EXCLUDED.ical_sequence
			WHERE calendar_events.ical_sequence <= EXCLUDED.ical_sequence`,
			[orgId, values.icalUid, values.sequence, values.title],
		)

	describe('when the conflict target names both columns of the unique index', () => {
		it('should store the invitation and update it when it is sent again', async () => {
			// GIVEN an invitation that has not been seen before
			// WHEN it is written, then sent again with a higher sequence
			// THEN one row exists carrying the newer title
			const icalUid = `contract-${randomUUID()}@calendar.batuda`
			seededIcalUids.push(icalUid)

			const stored = await withOrgScope(async client => {
				await upsert(client, 'organization_id, ical_uid', {
					icalUid,
					sequence: 0,
					title: 'First send',
				})
				await upsert(client, 'organization_id, ical_uid', {
					icalUid,
					sequence: 3,
					title: 'Moved to Thursday',
				})
				const result = await client.query<{
					count: string
					title: string
					ical_sequence: number
				}>(
					`SELECT count(*)::text AS count, max(title) AS title,
					        max(ical_sequence) AS ical_sequence
					 FROM calendar_events WHERE ical_uid = $1`,
					[icalUid],
				)
				return result.rows[0]
			})

			expect(stored?.count).toBe('1')
			expect(stored?.title).toBe('Moved to Thursday')
			expect(stored?.ical_sequence).toBe(3)
		})

		it('should ignore a re-send that is older than what is stored', async () => {
			// GIVEN an invitation already updated to sequence 3
			// WHEN an out-of-order copy arrives carrying sequence 1
			// THEN the stored row keeps the newer title
			const icalUid = `contract-${randomUUID()}@calendar.batuda`
			seededIcalUids.push(icalUid)

			const stored = await withOrgScope(async client => {
				await upsert(client, 'organization_id, ical_uid', {
					icalUid,
					sequence: 3,
					title: 'Current',
				})
				await upsert(client, 'organization_id, ical_uid', {
					icalUid,
					sequence: 1,
					title: 'Stale copy',
				})
				const result = await client.query<{ title: string }>(
					`SELECT title FROM calendar_events WHERE ical_uid = $1`,
					[icalUid],
				)
				return result.rows[0]
			})

			expect(stored?.title).toBe('Current')
		})
	})

	describe('when the conflict target names only ical_uid', () => {
		it('should be rejected because no unique index covers that column alone', async () => {
			// GIVEN a conflict target of just `ical_uid`
			// WHEN the upsert runs
			// THEN Postgres refuses it, because the table is unique on
			//      (organization_id, ical_uid) and a conflict target has to
			//      match an index exactly. Every booking and emailed
			//      invitation fails this way, so the shape stays pinned.
			const icalUid = `contract-${randomUUID()}@calendar.batuda`

			await expect(
				withOrgScope(client =>
					upsert(client, 'ical_uid', {
						icalUid,
						sequence: 0,
						title: 'Never stored',
					}),
				),
			).rejects.toThrow(/no unique or exclusion constraint matching/i)
		})
	})

	describe('when the same invitation reaches two organizations', () => {
		it('should keep a separate row for each one', async () => {
			// GIVEN one invitation id used by two different organizations
			// WHEN each is written
			// THEN both survive — the pair, not the id alone, is what is unique
			const icalUid = `contract-${randomUUID()}@calendar.batuda`
			seededIcalUids.push(icalUid)

			const otherOrg = await pool.query<{ id: string }>(
				`SELECT id FROM organization WHERE id <> $1 LIMIT 1`,
				[orgId],
			)
			const otherOrgId = otherOrg.rows[0]?.id
			if (!otherOrgId) {
				throw new Error('a second organization is required — reseed first')
			}

			// Written with the owner's privileges: each row belongs to a
			// different organization, and one scoped session may only see its own.
			await pool.query(
				`INSERT INTO calendar_events (
					organization_id, source, provider, provider_booking_id,
					ical_uid, ical_sequence, start_at, end_at, status,
					title, location_type, organizer_email
				)
				SELECT o, 'booking', 'calcom', 'bk-' || $3,
				       $3, 0, now(), now() + interval '30 minutes', 'confirmed',
				       'Shared invitation', 'video', 'organizer@taller.cat'
				FROM unnest(ARRAY[$1::text, $2::text]) AS o
				ON CONFLICT (organization_id, ical_uid) DO UPDATE SET
					title = EXCLUDED.title`,
				[orgId, otherOrgId, icalUid],
			)

			const rows = await pool.query<{ count: string }>(
				`SELECT count(*)::text AS count FROM calendar_events WHERE ical_uid = $1`,
				[icalUid],
			)
			expect(rows.rows[0]?.count).toBe('2')
		})
	})
})
