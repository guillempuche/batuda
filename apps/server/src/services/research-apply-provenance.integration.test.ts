// Live-DB integration test for the note a company keeps about where each of its
// facts came from. A run cites the page it read a value on by the id it holds
// for that page, which means nothing outside the run — so the apply turns it
// into the page's real address and records which run said so.
//
// Driven through the real resolve path and read back through the Company shape
// the API returns: only the database knows which pages a run fetched, and only
// decoding the row proves the note it stored can still be served to a reader.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, Schema } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import { Company } from '@batuda/domain'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { Geocoder } from './geocoder'
import { resolveResearchProposedUpdate } from './research-apply'
import { TimelineActivityService } from './timeline-activity'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `prov-org-${randomUUID()}`
const PAGE_URL = 'https://acme.es/about'

let pool: pg.Pool

const deps = Layer.mergeAll(
	TimelineActivityService.layer,
	CompanyService.layer,
	Geocoder.layer,
).pipe(Layer.provide(FetchHttpClient.layer), Layer.provideMerge(PgLive))

const apply = (runId: string, proposalId: string) =>
	resolveResearchProposedUpdate(runId, proposalId, 'apply', null).pipe(
		Effect.provideService(CurrentOrg, { id: ORG, name: 'p', slug: 'p' }),
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

// A page the run fetched, linked to that run — the only way a cited page id
// resolves to an address.
const seedFetchedPage = async (runId: string): Promise<string> => {
	const sourceId = `src-${randomUUID().slice(0, 12)}`
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'firecrawl', $2, $3, 'acme.es', 'hash')`,
		[sourceId, PAGE_URL, randomUUID()],
	)
	await pool.query(
		`INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref)
		 VALUES ($1, $2, $3, 'S1')`,
		[ORG, runId, sourceId],
	)
	return sourceId
}

// A succeeded run proposing one company field, citing whichever page `cite`
// names for it.
const seedRun = async (
	companyId: string,
	cite: (runId: string) => Promise<string>,
): Promise<{ runId: string; proposalId: string }> => {
	const proposalId = randomUUID()
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, context, findings)
		 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb, '{}'::jsonb) RETURNING id`,
		[
			ORG,
			JSON.stringify({ subjects: [{ table: 'companies', id: companyId }] }),
		],
	)
	const runId = r.rows[0]!.id
	const sourceId = await cite(runId)
	await pool.query(
		`UPDATE research_runs SET findings = $2::jsonb WHERE id = $1`,
		[
			runId,
			JSON.stringify({
				proposed_updates: [
					{
						id: proposalId,
						status: 'pending',
						subject_table: 'companies',
						operation: 'update',
						subject_id: companyId,
						expected_version: 0,
						fields: {
							industry: {
								value: 'transport',
								source_id: sourceId,
								confidence: 0.9,
							},
						},
						citations: [],
					},
				],
			}),
		],
	)
	return { runId, proposalId }
}

// The driver hands each column back spelled the way the database spells it,
// while the shape spells the same field the way the rest of the app does.
const toShapeKey = (column: string) =>
	column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())

// Read the company back the way the API does, so a note that breaks the shape
// fails here exactly as it would for a reader.
const decodeCompany = (companyId: string) =>
	pool
		.query(`SELECT * FROM companies WHERE id = $1`, [companyId])
		.then(result => {
			const row = result.rows[0] as Record<string, unknown>
			const shaped = Object.fromEntries(
				Object.entries(row).map(([column, value]) => [
					toShapeKey(column),
					value,
				]),
			)
			return Effect.runPromise(Schema.decodeUnknownEffect(Company)(shaped))
		})

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

describe('the note a company keeps about where a fact came from', () => {
	describe('when the run cited a page it fetched', () => {
		it('should record the page address and the run that read it', async () => {
			// GIVEN a company and a run proposing its industry, cited to a page the
			// run actually fetched
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun(companyId, seedFetchedPage)

			// WHEN the proposal is applied
			await apply(runId, proposalId)

			// THEN the note points at the page's real address, credits the run, and
			// the company still reads back through the shape the API returns
			const company = await decodeCompany(companyId)
			expect(company.industry).toBe('transport')
			expect(company.fieldProvenance?.['industry']).toEqual({
				sourceUrl: PAGE_URL,
				runId,
				confidence: 0.9,
			})
		})
	})

	describe('when the run cited a page it never fetched', () => {
		it('should apply the value and claim nothing about where it came from', async () => {
			// GIVEN a run citing a page id that no fetch of that run recorded
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun(
				companyId,
				async () => `src-never-fetched-${randomUUID().slice(0, 8)}`,
			)

			// WHEN the proposal is applied
			await apply(runId, proposalId)

			// THEN the value lands, and no note is invented that would point nowhere
			const company = await decodeCompany(companyId)
			expect(company.industry).toBe('transport')
			expect(company.fieldProvenance).toBeNull()
		})
	})
})
