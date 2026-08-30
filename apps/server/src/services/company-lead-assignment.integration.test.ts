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
const ALICE: EmailActor = {
	userId: 'user-alice',
	isAgent: false,
	claimsLead: true,
}
const BOB: EmailActor = { userId: 'user-bob', isAgent: false, claimsLead: true }

let pool: pg.Pool
let tallerOrgId: string
let companyId: string
// Its own mailbox, because another suite truncates the seeded ones.
let inboxId: string

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
	const placeholder = new Uint8Array([0])
	const inbox = await pool.query<{ id: string }>(
		`INSERT INTO inboxes (
			organization_id, email, owner_user_id, is_default, is_private,
			grant_status, imap_host, imap_port, imap_security,
			smtp_host, smtp_port, smtp_security, username,
			password_ciphertext, password_nonce, password_tag
		) VALUES (
			$1, $2, NULL, false, false,
			'connected', 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', $2,
			$3, $3, $3
		) RETURNING id`,
		[tallerOrgId, `${FIXTURE_SLUG}@test.local`, placeholder],
	)
	inboxId = inbox.rows[0]!.id
	// Alice and Bob have to really work here: the claim refuses to hand a lead
	// to somebody the organisation does not list, so invented ids would make
	// every case below fail for the wrong reason.
	for (const userId of [ALICE.userId, BOB.userId]) {
		await pool.query(
			`INSERT INTO "user" (id, name, email, "emailVerified")
			 VALUES ($1, $1, $2, true) ON CONFLICT (id) DO NOTHING`,
			[userId, `${userId}@test.local`],
		)
		await pool.query(
			`INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
			 VALUES ($1, $2, $3, 'member', now()) ON CONFLICT (id) DO NOTHING`,
			[`m-${FIXTURE_SLUG}-${userId}`, tallerOrgId, userId],
		)
	}
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
	await pool.query(`DELETE FROM inboxes WHERE id = $1`, [inboxId])
	await pool.query(`DELETE FROM member WHERE id LIKE $1`, [
		`m-${FIXTURE_SLUG}-%`,
	])
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
			// THEN the stage write moved it, so a research proposal prepared
			// beforehand no longer matches and has to be re-checked. The owner
			// write leaves it alone: research cannot write an owner, so bumping
			// there would only invalidate proposals about unrelated fields.
			const after = await company()
			expect(after.version).toBe(before.version + 1)
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
			// GIVEN a company that wrote in first, and a date on the row to match.
			// The claim never reads either: what the archive holds says nothing
			// about whether anybody is working the lead now.
			const seeded = await pool.query(
				`INSERT INTO email_messages (
					organization_id, inbox_id, folder, message_id, direction,
					received_at, status, status_updated_at, company_id, raw_rfc822_ref
				)
				VALUES ($1, $5, 'INBOX', $2, 'inbound', now(), 'normal', now(), $3, $4)`,
				[
					tallerOrgId,
					`<older-${randomUUID()}@example.test>`,
					companyId,
					`raw/${randomUUID()}`,
					inboxId,
				],
			)
			// This case says nothing unless the older message is really there,
			// so pin it: a fixture that landed nowhere leaves a copy of the
			// first test.
			expect(seeded.rowCount).toBe(1)
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
			await claimScoped({
				userId: 'user-agent',
				isAgent: true,
				claimsLead: true,
			})
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

	describe('when the company was taken out of view', () => {
		it('should change nothing on a soft-deleted lead', async () => {
			// GIVEN a company somebody deleted, still reachable through an open
			// thread — the mail path never checks whether it is in view
			await pool.query(
				`UPDATE companies SET deleted_at = now() WHERE id = $1`,
				[companyId],
			)
			// WHEN Alice emails it
			await claimScoped(ALICE)
			// THEN it comes back from restore as it was dropped: no owner nobody
			// assigned, no stage it never reached, nothing on its history
			const row = await company()
			expect(row.owner_id).toBeNull()
			expect(row.status).toBe('prospect')
			expect(await historyRows()).toEqual([])
			await pool.query(`UPDATE companies SET deleted_at = NULL WHERE id = $1`, [
				companyId,
			])
		})
	})

	describe('when the sender no longer works here', () => {
		it('should not hand them the lead, but should still move the stage', async () => {
			// GIVEN somebody removed from the organisation whose session still
			// points at it — `owner_id` has nothing in the database behind it, so
			// this check is all that refuses them
			// WHEN they email an untouched company
			await claimScoped({
				userId: 'user-not-a-member',
				isAgent: false,
				claimsLead: true,
			})
			// THEN the lead stays unclaimed rather than landing on somebody whose
			// name no per-person view would ever match — but an email did go out,
			// so the company counts as contacted
			const row = await company()
			expect(row.owner_id).toBeNull()
			expect(row.status).toBe('contacted')
			expect((await historyRows()).map(h => h.kind)).toEqual(['stage_changed'])
		})
	})

	describe('when the send is somebody answering, not reaching out', () => {
		it('should claim nothing even though a person sent it', async () => {
			// GIVEN a real person's reply to an invitation they were sent
			// WHEN it goes out
			await claimScoped({
				userId: 'user-alice',
				isAgent: false,
				claimsLead: false,
			})
			// THEN they are still the sender for attribution's sake, but the lead
			// is untouched — answering is not outreach
			const row = await company()
			expect(row.owner_id).toBeNull()
			expect(row.status).toBe('prospect')
			expect(await historyRows()).toEqual([])
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
			// AND the claim left nothing behind. This one dies on its first
			// statement, so there is no half-done claim to undo here — that case
			// is the savepoint's own job.
			const row = await company()
			expect(row.owner_id).toBeNull()
			expect(row.status).toBe('prospect')
			expect(await historyRows()).toEqual([])
		})
	})
})
