// Executes TimelineActivityService.record() against a real Postgres. The
// company-cadence denorm is the one part the pure-helper unit tests can't
// reach: last_*_at uses GREATEST (so a late, older event can't regress it),
// while next_calendar_event_at recomputes from calendar_events (so it can
// DECREASE — something GREATEST could never do).
//
// Prereq: `pnpm cli services up` and a seeded `taller` org.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import {
	EmailSent,
	MeetingCancelled,
	MeetingScheduled,
	TimelineActivityService,
	type TimelineEvent,
} from './timeline-activity'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const FIXTURE_SLUG = `cadence-${randomUUID()}`

let pool: pg.Pool
let tallerOrgId: string
let companyId: string

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const org = await pool.query<{ id: string }>(
		`SELECT id FROM organization WHERE slug = 'taller' LIMIT 1`,
	)
	const id = org.rows[0]?.id
	if (!id) {
		throw new Error(
			"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
		)
	}
	tallerOrgId = id
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name) VALUES ($1, $2, $2) RETURNING id`,
		[tallerOrgId, FIXTURE_SLUG],
	)
	companyId = company.rows[0]!.id
}, 30_000)

afterAll(async () => {
	// Superuser cleanup (no role switch) — bypasses RLS on the fixture rows.
	await pool.query(`DELETE FROM timeline_activity WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM calendar_events WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId])
	await pool.end()
})

// Records one event as role app_user scoped to the taller org — the same
// role + GUC + CurrentOrg the request path establishes, so the cadence
// UPDATEs pass RLS exactly as in production.
const recordScoped = (event: TimelineEvent): Promise<unknown> => {
	const deps = TimelineActivityService.layer.pipe(Layer.provideMerge(PgLive))
	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${tallerOrgId}, true)`
				return yield* timeline.record(event).pipe(
					Effect.provideService(CurrentOrg, {
						id: tallerOrgId,
						name: 'fixture',
						slug: 'fixture',
					}),
				)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)
}

const seedConfirmedMeeting = async (startAt: Date): Promise<string> => {
	const id = randomUUID()
	await pool.query(
		`INSERT INTO calendar_events (
			id, organization_id, company_id, source, provider, provider_booking_id,
			ical_uid, ical_sequence, start_at, end_at, status, title,
			location_type, organizer_email
		) VALUES (
			$1::uuid, $2, $3::uuid, 'booking', 'calcom', $4,
			$5, 0, $6, $7, 'confirmed', 'Cadence test',
			'video', 'organizer@taller.cat'
		)`,
		[
			id,
			tallerOrgId,
			companyId,
			`booking-${id}`,
			`ical-${id}`,
			startAt,
			new Date(startAt.getTime() + 1_800_000),
		],
	)
	return id
}

const companyCadence = async (): Promise<{
	last_email_at: Date | null
	next_calendar_event_at: Date | null
}> => {
	const rows = await pool.query<{
		last_email_at: Date | null
		next_calendar_event_at: Date | null
	}>(
		`SELECT last_email_at, next_calendar_event_at FROM companies WHERE id = $1`,
		[companyId],
	)
	return rows.rows[0]!
}

describe('TimelineActivityService.record cadence denorm', () => {
	describe('when emails are recorded out of order', () => {
		it('should keep last_email_at at the newest (GREATEST, no regression)', async () => {
			// GIVEN an email at T2 then a late-delivered email at an earlier T1
			const t2 = new Date(Date.now() - 60_000)
			const t1 = new Date(Date.now() - 3_600_000)
			const email = (occurredAt: Date) =>
				new EmailSent({
					emailMessageId: randomUUID(),
					companyId,
					contactId: null,
					subject: 'cadence',
					summary: null,
					actorUserId: null,
					occurredAt,
				})

			// WHEN both are recorded, newest first
			await recordScoped(email(t2))
			await recordScoped(email(t1))

			// THEN last_email_at still holds T2 — GREATEST ignored the older event
			// [timeline-activity.ts — bumpCompany GREATEST(last_email_at, at)]
			const cadence = await companyCadence()
			expect(cadence.last_email_at?.toISOString()).toBe(t2.toISOString())
		})
	})

	describe('when the only upcoming meeting is cancelled', () => {
		it('should let next_calendar_event_at decrease (recompute from source)', async () => {
			// GIVEN a confirmed future meeting recorded for the company
			const startAt = new Date(Date.now() + 10 * 86_400_000)
			const calId = await seedConfirmedMeeting(startAt)
			await recordScoped(
				new MeetingScheduled({
					calendarEventId: calId,
					companyId,
					contactId: null,
					source: 'booking',
					title: 'Cadence test',
					startAt,
					endAt: new Date(startAt.getTime() + 1_800_000),
					actorUserId: null,
					occurredAt: new Date(),
				}),
			)
			const scheduled = await companyCadence()
			expect(scheduled.next_calendar_event_at?.toISOString()).toBe(
				startAt.toISOString(),
			)

			// WHEN it is cancelled, leaving no confirmed future event
			await pool.query(
				`UPDATE calendar_events SET status = 'cancelled' WHERE id = $1::uuid`,
				[calId],
			)
			await recordScoped(
				new MeetingCancelled({
					calendarEventId: calId,
					companyId,
					contactId: null,
					cancelledStartAt: startAt,
					actorUserId: null,
					occurredAt: new Date(),
				}),
			)

			// THEN next_calendar_event_at recomputes to NULL — a DECREASE that
			// GREATEST could never produce
			// [timeline-activity.ts — recomputeCompanyNextMeeting MIN(...)]
			const cancelled = await companyCadence()
			expect(cancelled.next_calendar_event_at).toBeNull()
		})
	})
})
