// Live-DB integration test for the company detail every surface reads — the web
// app's company page and the get_company tool both come through here.
//
// It covers the research history the detail now carries, including the ordinary
// case of a company nobody has researched: that path decodes an empty result, so
// getting it wrong would break every company page rather than just a researched
// one.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { linkSubjectToRun } from './research-apply'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `detail-org-${randomUUID()}`

const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

let pool: pg.Pool

const seedCompany = async (): Promise<{ id: string; slug: string }> => {
	const slug = `acme-${randomUUID()}`
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[ORG, slug],
	)
	return { id: r.rows[0]?.id ?? '', slug }
}

const seedRun = async (completedAt: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, completed_at)
		 VALUES ($1, 'detail q', 'succeeded', 'u1', $2) RETURNING id`,
		[ORG, completedAt],
	)
	return r.rows[0]?.id ?? ''
}

const seedSource = async (url: string): Promise<string> => {
	const id = `src_${randomUUID().replace(/-/g, '').slice(0, 16)}`
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'test', $2, $3, 'acme.es', 'chash')`,
		[id, url, `hash_${randomUUID()}`],
	)
	return id
}

const searchWith = (filters: Record<string, unknown>) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* CompanyService
			const page = yield* svc.search(filters)
			return page.items
		}).pipe(
			Effect.provideService(CurrentOrg, {
				id: ORG,
				name: 'd',
				slug: 'd',
				role: 'member',
			}),
		),
	)

const detailOf = (slug: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* CompanyService
			return yield* svc.getWithRelations(slug)
		}).pipe(
			Effect.provideService(CurrentOrg, {
				id: ORG,
				name: 'd',
				slug: 'd',
				role: 'member',
			}),
		),
	)

const linkRunToCompany = (runId: string, companyId: string, sourceId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* linkSubjectToRun(sql, ORG, runId, 'companies', companyId, [
				{ source_id: sourceId },
			])
		}),
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.end()
	await runtime.dispose()
})

describe('the company detail', () => {
	describe('when nobody has researched the company', () => {
		it('should still load, with an empty research history', async () => {
			// GIVEN an ordinary company with no research behind it
			const { slug } = await seedCompany()

			// WHEN its detail is read
			const detail = await detailOf(slug)

			// THEN it loads and simply has nothing to show
			expect(detail.researchRuns).toEqual([])
		})
	})

	describe('when research has been applied to the company', () => {
		it('should list each run with the pages its citations point at', async () => {
			// GIVEN a company a run was applied to, citing one page
			const { id, slug } = await seedCompany()
			const runId = await seedRun('2026-07-01T09:00:00Z')
			const sourceId = await seedSource('https://acme.es/about')
			await linkRunToCompany(runId, id, sourceId)

			// WHEN its detail is read
			const detail = await detailOf(slug)

			// THEN the run is there, with the page behind it
			expect(detail.researchRuns.length).toBe(1)
			expect(detail.researchRuns[0]?.runId).toBe(runId)
			expect(detail.researchRuns[0]?.sources).toEqual([
				{ sourceId, url: 'https://acme.es/about' },
			])
		})
	})

	describe('when several runs have been applied over time', () => {
		it('should put the most recent first', async () => {
			// GIVEN two runs on the same company, months apart
			const { id, slug } = await seedCompany()
			const older = await seedRun('2026-01-05T09:00:00Z')
			const newer = await seedRun('2026-07-05T09:00:00Z')
			const sourceId = await seedSource(`https://acme.es/${randomUUID()}`)
			await linkRunToCompany(older, id, sourceId)
			await linkRunToCompany(newer, id, sourceId)

			// WHEN its detail is read
			const detail = await detailOf(slug)

			// THEN the newest run leads, so the freshest research reads first
			expect(detail.researchRuns.map(r => r.runId)).toEqual([newer, older])
		})
	})

	describe('when the company carries a brief and a fit verdict', () => {
		it('should hand them back with the rest of the row', async () => {
			// GIVEN a company research has already written to
			const { id, slug } = await seedCompany()
			await pool.query(
				`UPDATE companies
				 SET account_brief = $2, fit_verdict = $3, field_provenance = $4
				 WHERE id = $1`,
				[
					id,
					'## Acme\n\nA carrier.',
					'strong_fit',
					JSON.stringify({
						industry: { sourceUrl: 'https://acme.es/about', runId: 'r1' },
					}),
				],
			)

			// WHEN its detail is read
			const detail = await detailOf(slug)

			// THEN the notes, the verdict and the per-field sources all come through
			expect(detail.accountBrief).toBe('## Acme\n\nA carrier.')
			expect(detail.fitVerdict).toBe('strong_fit')
			expect(detail.fieldProvenance?.['industry']?.sourceUrl).toBe(
				'https://acme.es/about',
			)
		})
	})
})

describe('filtering companies by how well they fit', () => {
	describe('when filtering by the overall verdict', () => {
		it('should return only the companies judged that way', async () => {
			// GIVEN two companies research judged differently
			const strong = await seedCompany()
			const weak = await seedCompany()
			await pool.query(`UPDATE companies SET fit_verdict = $2 WHERE id = $1`, [
				strong.id,
				'strong_fit',
			])
			await pool.query(`UPDATE companies SET fit_verdict = $2 WHERE id = $1`, [
				weak.id,
				'no_fit',
			])

			// WHEN the strong fits are asked for
			const rows = await searchWith({ fitVerdict: 'strong_fit' })

			// THEN only the strong one comes back
			const ids = rows.map(r => r['id'])
			expect(ids).toContain(strong.id)
			expect(ids).not.toContain(weak.id)
		})
	})

	describe('when filtering by a criterion the company passed', () => {
		it('should match a pass and skip a fail on the same criterion', async () => {
			// GIVEN one company that passes the rule and one that fails it
			const passer = await seedCompany()
			const failer = await seedCompany()
			await pool.query(`UPDATE companies SET fit_checks = $2 WHERE id = $1`, [
				passer.id,
				JSON.stringify([{ criterion: 'asset-based carrier', result: 'pass' }]),
			])
			await pool.query(`UPDATE companies SET fit_checks = $2 WHERE id = $1`, [
				failer.id,
				JSON.stringify([{ criterion: 'asset-based carrier', result: 'fail' }]),
			])

			// WHEN the rule is asked about by part of its wording
			const rows = await searchWith({ fitCriterionPassed: 'asset-based' })

			// THEN only the company that actually meets it comes back
			const ids = rows.map(r => r['id'])
			expect(ids).toContain(passer.id)
			expect(ids).not.toContain(failer.id)
		})
	})

	describe('when most companies have never been researched', () => {
		it('should filter without tripping over their empty fit checks', async () => {
			// GIVEN a company nobody has researched, so its fit checks are absent
			const plain = await seedCompany()
			const passer = await seedCompany()
			await pool.query(`UPDATE companies SET fit_checks = $2 WHERE id = $1`, [
				passer.id,
				JSON.stringify([{ criterion: 'ships pallets', result: 'pass' }]),
			])

			// WHEN the criterion filter runs across them all
			const rows = await searchWith({ fitCriterionPassed: 'ships pallets' })

			// THEN the query succeeds and simply leaves the unresearched one out
			const ids = rows.map(r => r['id'])
			expect(ids).toContain(passer.id)
			expect(ids).not.toContain(plain.id)
		})
	})
})
