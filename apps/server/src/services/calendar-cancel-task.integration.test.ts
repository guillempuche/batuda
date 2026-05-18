// Integration test for the SQL contract that ingestCalcomCancel relies on.
//
// We DON'T construct a full CalendarService layer here — its dependency
// graph (BookingProvider, IcsParser, TimelineActivityService,
// ParticipantMatcher) is heavy and the dispatch through
// handleCalcomWebhook is exercised end-to-end by the Playwright spec at
// `apps/internal/tests/e2e/calendar-on-company.test.ts`.
//
// Instead, this test asserts the SQL invariants ingestCalcomCancel
// depends on — companyId-null guard, FOR UPDATE serialisation, and
// idempotency-by-linked_calendar_event_id — using a raw pg connection
// with `SET app.current_org_id` so the org_isolation_* RLS policies
// engage exactly as they do in production.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on $DATABASE_URL.

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const TALLER_SLUG = 'taller'

describe('ingestCalcomCancel — SQL contract', () => {
	let pool: pg.Pool
	let orgId: string

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
		await pool.query('GRANT app_user TO CURRENT_USER')

		const orgs = await pool.query<{ id: string }>(
			`SELECT id FROM organization WHERE slug = $1 LIMIT 1`,
			[TALLER_SLUG],
		)
		const id = orgs.rows[0]?.id
		if (!id) {
			throw new Error(
				`taller org missing — run 'pnpm cli db reset && pnpm cli seed' before this test`,
			)
		}
		orgId = id
	})

	afterAll(async () => {
		// Drop the fixture company (cascades to any leftover calendar_events)
		await pool.query(
			`DELETE FROM companies WHERE slug = 'cancel-task-fixture' AND organization_id = $1`,
			[orgId],
		)
		await pool.end()
	})

	const insertEvent = async (
		client: pg.PoolClient,
		args: {
			id: string
			icalUid: string
			companyId: string | null
			contactId: string | null
		},
	) => {
		await client.query(
			`INSERT INTO calendar_events (
				id, organization_id, source, provider, provider_booking_id,
				ical_uid, ical_sequence, start_at, end_at, status, title,
				location_type, organizer_email, company_id, contact_id
			) VALUES (
				$1::uuid, $2, 'booking', 'calcom', $6,
				$3, 0, now() + interval '7 days', now() + interval '7 days 30 minutes',
				'confirmed', 'Discovery call',
				'video', 'organizer@taller.cat', $4::uuid, $5::uuid
			)`,
			[
				args.id,
				orgId,
				args.icalUid,
				args.companyId,
				args.contactId,
				`booking-${args.id}`,
			],
		)
	}

	// Replicates the exact SQL ingestCalcomCancel runs after FOR UPDATE.
	// Returns the inserted task ids for assertion.
	const cancelAndCreateTask = async (
		client: pg.PoolClient,
		eventId: string,
	): Promise<ReadonlyArray<string>> => {
		// 1. Mark cancelled
		await client.query(
			`UPDATE calendar_events SET status='cancelled', updated_at=now() WHERE id=$1`,
			[eventId],
		)

		// 2. SELECT FOR UPDATE — serialises concurrent retries
		await client.query(`SELECT 1 FROM calendar_events WHERE id=$1 FOR UPDATE`, [
			eventId,
		])

		// 3. Read the row to get companyId / contactId / startAt
		const target = await client.query<{
			id: string
			company_id: string | null
			contact_id: string | null
			start_at: Date
			title: string
		}>(
			`SELECT id, company_id, contact_id, start_at, title FROM calendar_events WHERE id=$1`,
			[eventId],
		)
		const row = target.rows[0]
		if (!row) return []

		// 4. companyId-null guard
		if (!row.company_id) return []

		// 5. Idempotency check
		const existing = await client.query<{ id: string }>(
			`SELECT id FROM tasks
			 WHERE linked_calendar_event_id=$1
			   AND type='followup'
			   AND source='booking'
			 LIMIT 1`,
			[eventId],
		)
		if (existing.rows.length > 0) return []

		// 6. INSERT task
		const taskId = randomUUID()
		const dueAt = new Date(row.start_at.getTime() + 24 * 60 * 60 * 1000)
		await client.query(
			`INSERT INTO tasks (
				id, organization_id, company_id, contact_id, type, title,
				source, priority, status, linked_calendar_event_id, due_at
			) VALUES (
				$1, $2, $3, $4, 'followup', $5,
				'booking', 'normal', 'open', $6, $7
			)`,
			[
				taskId,
				orgId,
				row.company_id,
				row.contact_id,
				`Follow up about cancelled meeting with attendee`,
				eventId,
				dueAt,
			],
		)
		return [taskId]
	}

	const withTx = async <T>(
		body: (client: pg.PoolClient) => Promise<T>,
	): Promise<T> => {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			await client.query(`SET LOCAL ROLE app_user`)
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

	const cleanupTask = async (eventId: string): Promise<void> => {
		await pool.query(`DELETE FROM tasks WHERE linked_calendar_event_id = $1`, [
			eventId,
		])
		await pool.query(`DELETE FROM calendar_events WHERE id = $1`, [eventId])
	}

	// `multi-org-isolation.test.ts` truncates `companies` between runs,
	// so we can't rely on the seed. Insert a fixture company on demand
	// (idempotent — slug is unique-per-org so the test re-uses an
	// existing fixture row across `it`s).
	const FIXTURE_COMPANY_SLUG = 'cancel-task-fixture'

	const seedCompany = async (): Promise<{
		companyId: string
		contactId: string | null
	}> => {
		const existing = await pool.query<{ id: string }>(
			`SELECT id FROM companies WHERE slug=$1 AND organization_id=$2 LIMIT 1`,
			[FIXTURE_COMPANY_SLUG, orgId],
		)
		let companyId = existing.rows[0]?.id
		if (!companyId) {
			const inserted = await pool.query<{ id: string }>(
				`INSERT INTO companies (organization_id, slug, name, status, source)
				 VALUES ($1, $2, 'Cancel-task fixture', 'prospect', 'manual')
				 RETURNING id`,
				[orgId, FIXTURE_COMPANY_SLUG],
			)
			companyId = inserted.rows[0]?.id
			if (!companyId) throw new Error('failed to insert fixture company')
		}
		return { companyId, contactId: null }
	}

	describe('when the cancelled event has a company link', () => {
		it('should create exactly one follow-up task tied to the calendar_event', async () => {
			// GIVEN a confirmed calendar_event for a real company
			const { companyId, contactId } = await seedCompany()
			const eventId = randomUUID()
			const icalUid = `cancel-test-${eventId}`

			await withTx(async client => {
				await insertEvent(client, {
					id: eventId,
					icalUid,
					companyId,
					contactId,
				})
			})

			// WHEN ingestCalcomCancel's SQL contract runs
			const created = await withTx(client =>
				cancelAndCreateTask(client, eventId),
			)

			// THEN one task was inserted
			expect(created).toHaveLength(1)

			// AND the task's shape matches handleMeetingEnded's precedent
			const tasks = await pool.query<{
				type: string
				source: string
				status: string
				linked_calendar_event_id: string
				company_id: string
				due_at: Date
			}>(
				`SELECT type, source, status, linked_calendar_event_id, company_id, due_at
				 FROM tasks WHERE id=$1`,
				[created[0]],
			)
			const task = tasks.rows[0]
			expect(task?.type).toBe('followup')
			expect(task?.source).toBe('booking')
			expect(task?.status).toBe('open')
			expect(task?.linked_calendar_event_id).toBe(eventId)
			expect(task?.company_id).toBe(companyId)
			expect(task?.due_at.getTime()).toBeGreaterThan(Date.now())

			await cleanupTask(eventId)
		})

		it('should no-op on a second call with the same event (idempotency)', async () => {
			// GIVEN a confirmed calendar_event for a real company
			const { companyId, contactId } = await seedCompany()
			const eventId = randomUUID()
			const icalUid = `idemp-test-${eventId}`

			await withTx(async client => {
				await insertEvent(client, {
					id: eventId,
					icalUid,
					companyId,
					contactId,
				})
			})

			// WHEN cancel runs twice (simulating webhook retry)
			const first = await withTx(client => cancelAndCreateTask(client, eventId))
			const second = await withTx(client =>
				cancelAndCreateTask(client, eventId),
			)

			// THEN the second call produces no task
			expect(first).toHaveLength(1)
			expect(second).toHaveLength(0)

			// AND the DB carries exactly one follow-up task for this event
			const count = await pool.query<{ count: string }>(
				`SELECT COUNT(*)::text AS count FROM tasks
				 WHERE linked_calendar_event_id=$1
				   AND type='followup'
				   AND source='booking'`,
				[eventId],
			)
			expect(count.rows[0]?.count).toBe('1')

			await cleanupTask(eventId)
		})
	})

	describe('when the cancelled event has no company link (organizer-only)', () => {
		it('should skip task creation but leave the calendar_event in cancelled state', async () => {
			// GIVEN a confirmed calendar_event with no company link
			const eventId = randomUUID()
			const icalUid = `null-co-test-${eventId}`

			await withTx(async client => {
				await insertEvent(client, {
					id: eventId,
					icalUid,
					companyId: null,
					contactId: null,
				})
			})

			// WHEN cancel runs
			const created = await withTx(client =>
				cancelAndCreateTask(client, eventId),
			)

			// THEN no task was inserted (companyId-null guard)
			expect(created).toHaveLength(0)

			// AND the event is still marked cancelled
			const events = await pool.query<{ status: string }>(
				`SELECT status FROM calendar_events WHERE id=$1`,
				[eventId],
			)
			expect(events.rows[0]?.status).toBe('cancelled')

			await cleanupTask(eventId)
		})
	})

	describe('when two webhook retries arrive concurrently', () => {
		it('should create exactly one follow-up task (FOR UPDATE serialises)', async () => {
			// GIVEN a confirmed calendar_event for a real company
			const { companyId, contactId } = await seedCompany()
			const eventId = randomUUID()
			const icalUid = `race-test-${eventId}`

			await withTx(async client => {
				await insertEvent(client, {
					id: eventId,
					icalUid,
					companyId,
					contactId,
				})
			})

			// WHEN two cancel transactions race against each other
			const [a, b] = await Promise.all([
				withTx(client => cancelAndCreateTask(client, eventId)),
				withTx(client => cancelAndCreateTask(client, eventId)),
			])

			// THEN exactly one of them inserted a task — the FOR UPDATE lock
			// blocks the second tx until the first commits, at which point
			// the idempotency check sees the row and no-ops.
			expect(a.length + b.length).toBe(1)

			const count = await pool.query<{ count: string }>(
				`SELECT COUNT(*)::text AS count FROM tasks
				 WHERE linked_calendar_event_id=$1`,
				[eventId],
			)
			expect(count.rows[0]?.count).toBe('1')

			await cleanupTask(eventId)
		})
	})
})
