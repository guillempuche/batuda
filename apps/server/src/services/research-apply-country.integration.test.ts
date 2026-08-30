// Live-DB integration test for stamping a research run's resolved country onto
// its target company at apply time. The country is a run-level attribute (the
// country the run researched), written from the run row — not a model-proposed
// field — and only onto the company the run was actually about, never onto a
// competitor the run merely mentioned.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { Geocoder } from './geocoder'
import { resolveResearchProposedUpdate } from './research-apply'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `country-org-${randomUUID()}`

let pool: pg.Pool

const deps = Layer.mergeAll(
	TimelineActivityService.layer,
	CompanyService.layer,
	Geocoder.layer,
).pipe(Layer.provide(FetchHttpClient.layer), Layer.provideMerge(PgLive))

const apply = (runId: string, proposalId: string) =>
	resolveResearchProposedUpdate(runId, proposalId, 'apply', null, {
		origin: 'person',
	}).pipe(
		Effect.provideService(CurrentOrg, {
			id: ORG,
			name: 'c',
			slug: 'c',
			role: 'member',
		}),
		Effect.provide(deps),
		Effect.orDie,
		Effect.runPromise,
	)

const seedCompany = async (): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[ORG, `acme-${randomUUID()}`],
	)
	return r.rows[0]!.id
}

// A succeeded run carrying a resolved country, a subjects context (the companies
// the run researched), and one pending company update.
const seedRun = async (opts: {
	country: string | null
	subjectCompanyIds: ReadonlyArray<string>
	proposalCompanyId: string
}): Promise<{ runId: string; proposalId: string }> => {
	const proposalId = randomUUID()
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs
			(organization_id, query, status, created_by, country, context, findings)
		 VALUES ($1, 'q', 'succeeded', 'u1', $2, $3::jsonb, $4::jsonb) RETURNING id`,
		[
			ORG,
			opts.country,
			JSON.stringify({
				subjects: opts.subjectCompanyIds.map(id => ({
					table: 'companies',
					id,
				})),
			}),
			JSON.stringify({
				proposed_updates: [
					{
						id: proposalId,
						status: 'pending',
						subject_table: 'companies',
						operation: 'update',
						subject_id: opts.proposalCompanyId,
						expected_version: 0,
						fields: { industry: 'transport' },
						citations: [],
					},
				],
			}),
		],
	)
	return { runId: r.rows[0]!.id, proposalId }
}

const countryOf = async (companyId: string): Promise<string | null> => {
	const r = await pool.query<{ country: string | null }>(
		`SELECT country FROM companies WHERE id = $1`,
		[companyId],
	)
	return r.rows[0]?.country ?? null
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

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

describe('resolveResearchProposedUpdate country stamp', () => {
	describe('when a run applies an update to its own target company', () => {
		it("should stamp the run's country onto the company alongside the proposed fields", async () => {
			// GIVEN a run that resolved country US and researched this company
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun({
				country: 'US',
				subjectCompanyIds: [companyId],
				proposalCompanyId: companyId,
			})

			// WHEN its company update is applied
			const outcome = await apply(runId, proposalId)

			// THEN the proposed field lands AND the run's country is stamped on
			expect(outcome.outcome).toBe('applied')
			const rows = await pool.query<{ industry: string; country: string }>(
				`SELECT industry, country FROM companies WHERE id = $1`,
				[companyId],
			)
			expect(rows.rows[0]?.industry).toBe('transport')
			expect(rows.rows[0]?.country).toBe('US')
		})
	})

	describe('when the run resolved no country', () => {
		it('should apply the proposed fields but leave country empty', async () => {
			// GIVEN a run that reached a terminal state without a country
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun({
				country: null,
				subjectCompanyIds: [companyId],
				proposalCompanyId: companyId,
			})

			// WHEN the update is applied
			const outcome = await apply(runId, proposalId)

			// THEN the field lands and no country is invented
			expect(outcome.outcome).toBe('applied')
			expect(await countryOf(companyId)).toBeNull()
		})
	})

	describe('when the update targets a company the run did not research', () => {
		it("should not stamp the run's country onto that other company", async () => {
			// GIVEN a run about company A whose proposal touches company B — a
			// competitor it merely mentioned, possibly in another country
			const target = await seedCompany()
			const other = await seedCompany()
			const { runId, proposalId } = await seedRun({
				country: 'US',
				subjectCompanyIds: [target],
				proposalCompanyId: other,
			})

			// WHEN the proposal on B is applied
			const outcome = await apply(runId, proposalId)

			// THEN B gets the proposed field but NOT the run's country — the country
			// describes A, the company the run was actually about
			expect(outcome.outcome).toBe('applied')
			expect(await countryOf(other)).toBeNull()
		})
	})
})
