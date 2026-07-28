// Live-DB integration test for bulk apply/reject: a mixed batch returns one
// outcome per item, a conflict/not-found on one proposal never aborts the rest,
// and proposals in the same run resolve one at a time (so an earlier apply's
// version bump makes a later stale proposal conflict). This exercises the full
// apply path end to end through the batch.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { Geocoder } from './geocoder'
import {
	type BatchResolveItem,
	resolveResearchProposedUpdatesBatch,
} from './research-apply'
import { TimelineActivityService } from './timeline-activity'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `batch-org-${randomUUID()}`

let pool: pg.Pool

// The apply path scopes every write by the org it is given, so the owner
// connection (bypassing RLS) plus a provided CurrentOrg is enough.
const deps = Layer.mergeAll(
	TimelineActivityService.layer,
	CompanyService.layer,
	Geocoder.layer,
).pipe(Layer.provide(FetchHttpClient.layer), Layer.provideMerge(PgLive))

const runBatch = (items: ReadonlyArray<BatchResolveItem>) =>
	resolveResearchProposedUpdatesBatch(items, 'u1').pipe(
		Effect.provideService(CurrentOrg, { id: ORG, name: 'b', slug: 'b' }),
		Effect.provide(deps),
		Effect.orDie,
		Effect.runPromise,
	)

let companyId: string
let contactId: string
let runId: string

const proposal = (overrides: Record<string, unknown>) => ({
	id: randomUUID(),
	status: 'pending',
	reason: 'r',
	citations: [],
	...overrides,
})

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[ORG, `acme-${randomUUID()}`],
	)
	companyId = company.rows[0]!.id
	const contact = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name)
		 VALUES ($1, $2, 'Ada') RETURNING id`,
		[ORG, companyId],
	)
	contactId = contact.rows[0]!.id
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM timeline_activity WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe('resolveResearchProposedUpdatesBatch', () => {
	describe('when a mixed batch is resolved', () => {
		it('should return one outcome per item without aborting on failures', async () => {
			// GIVEN one run holding several proposals: a valid update, a create,
			// a stale update, and one to reject
			const run = await pool.query<{ id: string }>(
				`INSERT INTO research_runs (organization_id, query, status, created_by, findings)
				 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb) RETURNING id`,
				[
					ORG,
					JSON.stringify({
						proposed_updates: [
							proposal({
								id: 'p1',
								subject_table: 'contacts',
								operation: 'update',
								subject_id: contactId,
								expected_version: 0,
								fields: { role: 'CTO' },
							}),
							proposal({
								id: 'p2',
								subject_table: 'contacts',
								operation: 'create',
								fields: { name: 'New Person', company_id: companyId },
							}),
							proposal({
								id: 'p3',
								subject_table: 'contacts',
								operation: 'update',
								subject_id: contactId,
								expected_version: 99,
								fields: { role: 'X' },
							}),
							proposal({
								id: 'p4',
								subject_table: 'contacts',
								operation: 'update',
								subject_id: contactId,
								expected_version: 0,
								fields: { notes: 'n' },
							}),
						],
					}),
				],
			)
			runId = run.rows[0]!.id
			const missingRun = randomUUID()

			// WHEN the batch resolves them, plus a missing proposal and a missing run
			const results = await runBatch([
				{ researchId: runId, proposedUpdateId: 'p1', decision: 'apply' },
				{ researchId: runId, proposedUpdateId: 'p2', decision: 'apply' },
				{ researchId: runId, proposedUpdateId: 'p3', decision: 'apply' },
				{ researchId: runId, proposedUpdateId: 'p4', decision: 'reject' },
				{ researchId: runId, proposedUpdateId: 'nope', decision: 'apply' },
				{ researchId: missingRun, proposedUpdateId: 'p1', decision: 'apply' },
			])

			// THEN every item has its own outcome and none aborted the batch
			expect(results).toHaveLength(6)
			const outcomeFor = (pid: string, rid = runId) =>
				results.find(r => r.research_id === rid && r.proposed_update_id === pid)
					?.outcome
			expect(outcomeFor('p1')).toBe('applied')
			expect(outcomeFor('p2')).toBe('created')
			// p1 bumped the contact version, so the stale p3 conflicts — proof the
			// items ran in order, not concurrently.
			expect(outcomeFor('p3')).toBe('conflict')
			expect(outcomeFor('p4')).toBe('rejected')
			expect(outcomeFor('nope')).toBe('proposal_not_found')
			expect(outcomeFor('p1', missingRun)).toBe('run_not_found')
		})

		it('should have actually written the applied change', async () => {
			// GIVEN the batch above applied p1 (role = CTO)
			// THEN the contact row really carries it
			const rows = await pool.query<{ role: string }>(
				`SELECT role FROM contacts WHERE id = $1`,
				[contactId],
			)
			expect(rows.rows[0]?.role).toBe('CTO')
		})
	})

	describe('when an update proposal has a non-UUID subject_id', () => {
		it('should report it invalid rather than crash on the bad id', async () => {
			// GIVEN a run whose update proposal carries a hallucinated non-UUID id
			// with an otherwise valid fields object, so only the id disqualifies it
			const run = await pool.query<{ id: string }>(
				`INSERT INTO research_runs (organization_id, query, status, created_by, findings)
				 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb) RETURNING id`,
				[
					ORG,
					JSON.stringify({
						proposed_updates: [
							proposal({
								id: 'bad',
								subject_table: 'contacts',
								operation: 'update',
								subject_id: 'not-a-uuid',
								expected_version: 0,
								fields: { role: 'Ghost' },
							}),
						],
					}),
				],
			)
			const badRunId = run.rows[0]!.id

			// WHEN it is applied
			const results = await runBatch([
				{ researchId: badRunId, proposedUpdateId: 'bad', decision: 'apply' },
			])

			// THEN the bad id is reported as invalid, not raised as a server error
			expect(results).toHaveLength(1)
			expect(results[0]?.outcome).toBe('invalid')
		})
	})

	describe('when the run needs somebody to read it', () => {
		it('should refuse to apply in bulk but still allow rejecting', async () => {
			// GIVEN a run that finished unsure which company it was about, carrying
			//   a suggestion that is otherwise perfectly ordinary
			const run = await pool.query<{ id: string }>(
				`INSERT INTO research_runs (organization_id, query, status, created_by, findings)
				 VALUES ($1, 'q', 'succeeded_low_confidence', 'u1', $2::jsonb) RETURNING id`,
				[
					ORG,
					JSON.stringify({
						proposed_updates: [
							proposal({
								id: 'unsure',
								subject_table: 'contacts',
								operation: 'update',
								subject_id: contactId,
								expected_version: 0,
								fields: { role: 'CFO' },
							}),
							proposal({
								id: 'discard',
								subject_table: 'contacts',
								operation: 'update',
								subject_id: contactId,
								expected_version: 0,
								fields: { role: 'CFO' },
							}),
						],
					}),
				],
			)
			const unsureRunId = run.rows[0]!.id

			// WHEN a batch tries to apply one and reject the other
			const results = await runBatch([
				{
					researchId: unsureRunId,
					proposedUpdateId: 'unsure',
					decision: 'apply',
				},
				{
					researchId: unsureRunId,
					proposedUpdateId: 'discard',
					decision: 'reject',
				},
			])

			// THEN applying is refused — the screens hide the button, but the rule
			//   has to hold for a request sent without them
			expect(
				results.find(r => r.proposed_update_id === 'unsure')?.outcome,
			).toBe('needs_review')
			// AND throwing one away is still fine: no second look is needed to
			//   discard a doubtful suggestion
			expect(
				results.find(r => r.proposed_update_id === 'discard')?.outcome,
			).toBe('rejected')

			// AND nothing was written
			const rows = await pool.query<{ role: string }>(
				`SELECT role FROM contacts WHERE id = $1`,
				[contactId],
			)
			expect(rows.rows[0]?.role).not.toBe('CFO')
		})
	})
})
