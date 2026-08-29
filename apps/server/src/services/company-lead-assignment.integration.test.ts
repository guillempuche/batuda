// Executes claimLeadOnEmail() against a real Postgres. The two conditional
// UPDATEs, what happens when two of them race for the same row, and the
// savepoint that keeps a failure here from taking the surrounding transaction
// down are all things only a real database shows.
//
// Prereq: `pnpm cli services up` and a seeded `taller` org.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/domain'

import { PgLive } from '../db/client'
import { claimLeadOnEmail, type EmailActor } from './company-lead-assignment'
import { TimelineActivityService } from './timeline-activity'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const FIXTURE_SLUG = `lead-claim-${randomUUID()}`
const SENT_AT = new Date('2026-03-01T10:00:00.000Z')
const ALICE: EmailActor = { userId: 'user-alice', isAgent: false }
const BOB: EmailActor = { userId: 'user-bob', isAgent: false }

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
	const insertedCompany = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name) VALUES ($1, $2, $2) RETURNING id`,
		[tallerOrgId, FIXTURE_SLUG],
	)
	companyId = insertedCompany.rows[0]!.id
}, 30_000)

afterAll(async () => {
	// Superuser cleanup (no role switch) — bypasses RLS on the fixture rows.
	await pool.query(`DELETE FROM timeline_activity WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM email_messages WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId])
	await pool.end()
})

// Back to an untouched lead: nobody owns it, nobody has worked it, and its
// history is empty.
beforeEach(async () => {
	await pool.query(
		`UPDATE companies SET owner_id = NULL, status = 'prospect', last_email_at = NULL WHERE id = $1`,
		[companyId],
	)
	await pool.query(`DELETE FROM timeline_activity WHERE company_id = $1`, [
		companyId,
	])
	await pool.query(`DELETE FROM email_messages WHERE company_id = $1`, [
		companyId,
	])
})

const deps = TimelineActivityService.layer.pipe(Layer.provideMerge(PgLive))

// Runs the claim as role app_user scoped to the taller org — the same role +
// GUC + CurrentOrg the request path establishes, so the UPDATEs meet RLS
// exactly as in production. `target` lets a test point the claim somewhere
// broken on purpose.
const claimScoped = (
	actor: EmailActor | null,
	target: string = companyId,
): Promise<unknown> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${tallerOrgId}, true)`
				yield* claimLeadOnEmail({
					companyId: target,
					actor,
					sentAt: SENT_AT,
				}).pipe(
					Effect.provideService(CurrentOrg, {
						id: tallerOrgId,
						name: 'fixture',
						slug: 'fixture',
						role: 'member',
					}),
				)
				// Written after the claim so a test can prove the surrounding
				// transaction survived a claim that blew up.
				return yield* sql`SELECT 'outer-survived' AS marker`
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const company = async (): Promise<{
	owner_id: string | null
	status: string
	version: number
}> => {
	const rows = await pool.query<{
		owner_id: string | null
		status: string
		version: number
	}>(`SELECT owner_id, status, version FROM companies WHERE id = $1`, [
		companyId,
	])
	return rows.rows[0]!
}

const historyRows = async (): Promise<
	ReadonlyArray<{ kind: string; occurred_at: Date; payload: unknown }>
> => {
	const rows = await pool.query<{
		kind: string
		occurred_at: Date
		payload: unknown
	}>(
		`SELECT kind, occurred_at, payload FROM timeline_activity
		 WHERE company_id = $1 ORDER BY occurred_at ASC`,
		[companyId],
	)
	return rows.rows
}

describe('claimLeadOnEmail', () => {
	describe('when the first person emails a lead nobody has touched', () => {
		it('should make it theirs and move it out of prospect', async () => {
			// GIVEN a company nobody owns, still sitting at prospect
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN it is hers, and it counts as contacted
			const row = await company()
			expect(row.owner_id).toBe('user-alice')
			expect(row.status).toBe('contacted')
		})

		it('should say so on the history, after the email itself', async () => {
			// GIVEN a company nobody owns, still at prospect
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN both entries are there, in the order they happened — each
			// stamped just after the send so a reader sees cause then effect
			const history = await historyRows()
			expect(history.map(h => h.kind)).toEqual([
				'lead_assigned',
				'stage_changed',
			])
			expect(history[0]!.occurred_at.getTime()).toBe(SENT_AT.getTime() + 1)
			expect(history[1]!.occurred_at.getTime()).toBe(SENT_AT.getTime() + 2)
		})

		it('should record who got the lead and why', async () => {
			// GIVEN a company nobody owns
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN the entry carries the new owner and the reason as plain data
			const [assigned] = await historyRows()
			expect(assigned!.payload).toEqual({
				ownerUserId: 'user-alice',
				reason: 'first_email',
			})
		})

		it('should bump the version so a stale proposal cannot undo it', async () => {
			// GIVEN a company at some known version
			const before = await company()
			// WHEN Alice emails it, claiming it and moving the stage
			await claimScoped(ALICE)
			// THEN the version moved for both writes, so a research proposal
			// prepared beforehand no longer matches and has to be re-checked
			const after = await company()
			expect(after.version).toBe(before.version + 2)
		})
	})

	describe('when somebody already owns the lead', () => {
		it('should leave the owner alone and say nothing about it', async () => {
			// GIVEN a company already owned by Bob
			await pool.query(`UPDATE companies SET owner_id = $2 WHERE id = $1`, [
				companyId,
				BOB.userId,
			])
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN it is still Bob's, and no assignment was recorded
			expect((await company()).owner_id).toBe('user-bob')
			expect((await historyRows()).map(h => h.kind)).not.toContain(
				'lead_assigned',
			)
		})

		it('should still move it out of prospect', async () => {
			// GIVEN a company owned by Bob but never worked
			await pool.query(`UPDATE companies SET owner_id = $2 WHERE id = $1`, [
				companyId,
				BOB.userId,
			])
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN the stage moves on its own terms — the two are separate
			// questions, and somebody was in fact contacted
			expect((await company()).status).toBe('contacted')
		})
	})

	describe('when the lead has already been worked past prospect', () => {
		it('should claim it but leave the stage where it is', async () => {
			// GIVEN an unowned company already at meeting
			await pool.query(
				`UPDATE companies SET status = 'meeting' WHERE id = $1`,
				[companyId],
			)
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN she takes it, and nothing drags the stage backwards
			const row = await company()
			expect(row.owner_id).toBe('user-alice')
			expect(row.status).toBe('meeting')
			expect((await historyRows()).map(h => h.kind)).toEqual(['lead_assigned'])
		})
	})

	describe('when the company has mail on file already', () => {
		it('should still claim it — stored mail is not what decides', async () => {
			// GIVEN a company that wrote in first, and a Sent folder read in from
			// a mailbox connected with history. Both land as direction='inbound'
			// (apps/mail-worker stores everything it fetches that way), so the
			// stored mail cannot say who sent what — which is exactly why the
			// claim never reads it.
			await pool.query(
				`INSERT INTO email_messages (
					organization_id, inbox_id, folder, message_id, direction,
					received_at, status, status_updated_at, company_id, raw_rfc822_ref
				)
				SELECT $1, i.id, 'INBOX', $2, 'inbound', now(), 'normal', now(), $3, $4
				FROM inboxes i WHERE i.organization_id = $1 LIMIT 1`,
				[
					tallerOrgId,
					`<older-${randomUUID()}@example.test>`,
					companyId,
					`raw/${randomUUID()}`,
				],
			)
			await pool.query(
				`UPDATE companies SET last_email_at = now() WHERE id = $1`,
				[companyId],
			)
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN she still takes it: nobody had claimed it, and that is the
			// question being asked
			expect((await company()).owner_id).toBe('user-alice')
		})
	})

	describe('when a second person emails a lead that is already claimed', () => {
		it('should change nothing at all', async () => {
			// GIVEN Alice emailed first
			await claimScoped(ALICE)
			await pool.query(`DELETE FROM timeline_activity WHERE company_id = $1`, [
				companyId,
			])
			// WHEN Bob emails the same company
			await claimScoped(BOB)
			// THEN it is still Alice's, still contacted, and nothing new is said
			const row = await company()
			expect(row.owner_id).toBe('user-alice')
			expect(row.status).toBe('contacted')
			expect(await historyRows()).toEqual([])
		})
	})

	describe('when nobody is behind the send', () => {
		it('should claim nothing for an automated reply', async () => {
			// GIVEN an automated calendar reply, which carries no actor
			// WHEN it goes out
			await claimScoped(null)
			// THEN the lead is untouched — nobody reached out
			const row = await company()
			expect(row.owner_id).toBeNull()
			expect(row.status).toBe('prospect')
			expect(await historyRows()).toEqual([])
		})

		it('should claim nothing for an agent', async () => {
			// GIVEN an agent sending on the org's behalf
			// WHEN it emails the company
			await claimScoped({ userId: 'user-agent', isAgent: true })
			// THEN no lead is handed to it: an owner has to be somebody who can
			// be asked about the account
			const row = await company()
			expect(row.owner_id).toBeNull()
			expect(row.status).toBe('prospect')
		})
	})

	describe('when two people email the same untouched lead at once', () => {
		it('should give it to exactly one of them, once', async () => {
			// GIVEN a company nobody owns
			// WHEN Alice and Bob email it at the same moment
			await Promise.all([claimScoped(ALICE), claimScoped(BOB)])
			// THEN one of them owns it and the other's claim matched no row, so
			// the history says it changed hands exactly once
			const row = await company()
			expect(['user-alice', 'user-bob']).toContain(row.owner_id)
			const assigned = (await historyRows()).filter(
				h => h.kind === 'lead_assigned',
			)
			expect(assigned).toHaveLength(1)
			expect(assigned[0]!.payload).toMatchObject({ ownerUserId: row.owner_id })
		})
	})

	describe('when the claim itself fails', () => {
		it('should keep the surrounding transaction alive', async () => {
			// GIVEN a claim pointed at something that cannot be a company id, so
			// Postgres rejects the statement
			// WHEN the send records itself around it
			const result = await claimScoped(ALICE, 'not-a-uuid')
			// THEN the failure stayed inside its own savepoint and the work that
			// wraps it still went through — by this point the message has left
			// over SMTP, and losing its record would have somebody send it twice
			expect(result).toEqual([{ marker: 'outer-survived' }])
		})
	})
})
