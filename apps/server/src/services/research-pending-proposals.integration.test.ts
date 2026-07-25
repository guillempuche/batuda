// Live-DB integration test for the cross-run review inbox query: pending
// proposed updates unnested from every run's findings, with the trust signals
// (0–100 confidence, email verdict, machine-checkable) and the filters a
// reviewer sorts by. Run scoped to app_user + an org GUC so row-level security
// isolates the fixtures from the rest of the database.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { queryPendingProposals } from '@batuda/research'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `inbox-org-${randomUUID()}`

let pool: pg.Pool

const pending = (over: Record<string, unknown>) => ({
	id: randomUUID(),
	status: 'pending',
	...over,
})

const seedRun = async (
	status: string,
	findings: unknown,
	createdAt: string,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, findings, created_at)
		 VALUES ($1, 'q', $2, 'u1', $3::jsonb, $4) RETURNING id`,
		[ORG, status, JSON.stringify(findings), createdAt],
	)
	return r.rows[0]!.id
}

interface Filters {
	subjectTable?: string
	status?: string
	minConfidence?: number
	machineCheckable?: boolean
	limit?: number
	offset?: number
}

// Query as app_user with the org GUC set, so RLS scopes the read to ORG.
const listScoped = (filters: Filters = {}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${ORG}, true)`
				const page = yield* queryPendingProposals(sql, filters)
				return page.items
			}),
		)
	}).pipe(Effect.provide(PgLive), Effect.orDie, Effect.runPromise)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// Let the connection role switch to app_user for the RLS-scoped reads.
	await pool.query('GRANT app_user TO CURRENT_USER')

	// Run A (oldest): a discovered contact with a verified email, plus an
	// already-applied proposal that must not surface.
	await seedRun(
		'succeeded',
		{
			proposed_updates: [
				pending({
					subject_table: 'contacts',
					operation: 'create',
					reason: 'discovered CTO',
					fields: {
						name: 'Ada',
						company_id: 'co1',
						channels: [
							{
								kind: 'email',
								value: 'ada@x.es',
								confidence: 0.9,
								verification: 'deliverable',
							},
						],
					},
				}),
				{
					id: randomUUID(),
					status: 'applied',
					subject_table: 'contacts',
					operation: 'create',
					fields: {},
				},
			],
		},
		'2026-05-01T10:00:00Z',
	)

	// Run B (newest): a free-text company update (no channel, no confidence) and
	// a discovered contact reachable only by phone.
	await seedRun(
		'succeeded',
		{
			proposed_updates: [
				pending({
					subject_table: 'companies',
					subject_id: 'co2',
					operation: 'update',
					reason: 'sector',
					fields: { industry: 'logistics' },
				}),
				pending({
					subject_table: 'contacts',
					operation: 'create',
					reason: 'phone found',
					fields: {
						name: 'Bob',
						company_id: 'co2',
						channels: [{ kind: 'phone', value: '+34600', confidence: 0.5 }],
					},
				}),
			],
		},
		'2026-05-10T10:00:00Z',
	)

	// Run C: still running, with its own pending proposal (for the status filter).
	await seedRun(
		'running',
		{
			proposed_updates: [
				pending({
					subject_table: 'contacts',
					operation: 'create',
					reason: 'other',
					fields: {
						name: 'Cy',
						company_id: 'co3',
						channels: [{ kind: 'email', value: 'cy@x.es', confidence: 0.7 }],
					},
				}),
			],
		},
		'2026-05-05T10:00:00Z',
	)
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.end()
})

describe('queryPendingProposals', () => {
	describe('when several runs hold pending proposals', () => {
		it('should return every pending one and skip the already-applied', async () => {
			// GIVEN four proposals across three runs, one already applied
			// WHEN the inbox is read
			const rows = await listScoped()

			// THEN only the four pending proposals surface
			expect(rows).toHaveLength(4)
			expect(rows.every(r => r.proposedUpdateId !== null)).toBe(true)
		})
	})

	describe('confidence and trust signals', () => {
		it('should normalize the strongest channel score to 0–100 and read the email verdict', async () => {
			// GIVEN a proposal whose email channel scores 0.9 with a verdict
			const rows = await listScoped({ subjectTable: 'contacts' })
			const ada = rows.find(r => r.reason === 'discovered CTO')

			// THEN the fraction is scaled to 90 and the verdict comes through
			expect(ada?.confidence).toBe(90)
			expect(ada?.verification).toBe('deliverable')
			expect(ada?.machineCheckable).toBe(true)
		})

		it('should leave a free-text update without a confidence and not machine-checkable', async () => {
			// GIVEN a company update carrying no channel
			const rows = await listScoped({ subjectTable: 'companies' })

			// THEN it has no score and is flagged as free text
			expect(rows).toHaveLength(1)
			expect(rows[0]?.confidence).toBeNull()
			expect(rows[0]?.verification).toBeNull()
			expect(rows[0]?.machineCheckable).toBe(false)
		})
	})

	describe('when filtered by subject table', () => {
		it('should return only proposals for that table', async () => {
			// GIVEN a mix of company and contact proposals
			const companies = await listScoped({ subjectTable: 'companies' })

			// THEN only company proposals come back
			expect(companies.every(r => r.subjectTable === 'companies')).toBe(true)
			expect(companies).toHaveLength(1)
		})
	})

	describe('when filtered by a minimum confidence', () => {
		it('should drop proposals below the threshold and those with none', async () => {
			// GIVEN scores of 90, 70, 50, and null across the pending set
			const rows = await listScoped({ minConfidence: 60 })

			// THEN only the 90 and 70 proposals qualify
			expect(rows.map(r => r.confidence).sort()).toEqual([70, 90])
		})
	})

	describe('when filtered to machine-checkable only', () => {
		it('should exclude free-text proposals', async () => {
			// GIVEN one free-text update and three verifiable-channel proposals
			const rows = await listScoped({ machineCheckable: true })

			// THEN only the verifiable ones remain
			expect(rows).toHaveLength(3)
			expect(rows.every(r => r.machineCheckable)).toBe(true)
		})
	})

	describe('when filtered by run status', () => {
		it('should return only proposals from runs in that status', async () => {
			// GIVEN two succeeded runs and one still running
			const running = await listScoped({ status: 'running' })

			// THEN only the running run's proposal is listed
			expect(running).toHaveLength(1)
			expect(running[0]?.runStatus).toBe('running')
		})
	})

	describe('ordering and pagination', () => {
		it('should list the newest run first', async () => {
			// GIVEN runs created on different dates
			const rows = await listScoped({ subjectTable: 'contacts' })

			// THEN the newest run's proposals lead (Run B before Run A/C)
			expect(rows[0]?.reason).toBe('phone found')
		})

		it('should cap results with the limit', async () => {
			// GIVEN four pending proposals
			const rows = await listScoped({ limit: 2 })

			// THEN only the first page is returned
			expect(rows).toHaveLength(2)
		})
	})
})
