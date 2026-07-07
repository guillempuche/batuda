// Live-DB integration test for the research→row provenance trail: the citations
// stored on the run↔row link when a suggestion is applied, and the read that
// resolves them back to source URLs.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import {
	type Citation,
	linkSubjectToRun,
	researchProvenance,
} from './research-apply'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = `prov-org-${randomUUID()}`
const OTHER_ORG = `prov-other-${randomUUID()}`

let pool: pg.Pool

const seedRun = async (org = ORG, completedAt?: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, completed_at)
		 VALUES ($1, 'prov q', 'succeeded', 'u1', $2) RETURNING id`,
		[org, completedAt ?? null],
	)
	return r.rows[0]?.id ?? ''
}

const seedSource = async (url: string): Promise<string> => {
	const id = `src_${randomUUID().replace(/-/g, '').slice(0, 16)}`
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'test', $2, $3, 'example.com', 'chash')`,
		[id, url, `hash_${randomUUID()}`],
	)
	return id
}

const link = (
	runId: string,
	subjectId: string,
	citations: ReadonlyArray<Citation>,
	subjectTable: 'companies' | 'contacts' = 'contacts',
	org = ORG,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* linkSubjectToRun(
				sql,
				org,
				runId,
				subjectTable,
				subjectId,
				citations,
			)
		}),
	)

const provenance = (
	subjectId: string,
	subjectTable: 'companies' | 'contacts' = 'contacts',
	org = ORG,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* researchProvenance(sql, org, subjectTable, subjectId)
		}),
	)

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	// research_links cascades from research_runs; sources are global, so clear
	// both the runs (this org's) and the sources this suite created.
	await pool.query(
		`DELETE FROM research_runs WHERE organization_id = ANY($1::text[])`,
		[[ORG, OTHER_ORG]],
	)
	await pool.query(`DELETE FROM sources WHERE provider = 'test'`)
	await runtime.dispose()
	await pool.end()
})

describe('linkSubjectToRun', () => {
	describe('when a row is applied from a run', () => {
		it('should store one finding link carrying the citations', async () => {
			// GIVEN a run and a discovered contact
			const runId = await seedRun()
			const subjectId = randomUUID()
			const citations: Citation[] = [
				{ source_id: 'src_a', quote: 'the CTO', confidence: 90 },
			]

			// WHEN the row is linked to the run
			await link(runId, subjectId, citations)

			// THEN a single finding link records the citations
			const rows = await pool.query<{
				link_kind: string
				citations: Citation[]
			}>(
				`SELECT link_kind, citations FROM research_links
				 WHERE research_id = $1 AND subject_id = $2`,
				[runId, subjectId],
			)
			expect(rows.rows).toHaveLength(1)
			expect(rows.rows[0]?.link_kind).toBe('finding')
			expect(rows.rows[0]?.citations).toEqual(citations)
		})
	})

	describe('when the same row is applied again', () => {
		it('should refresh the citations in place, not add a second link', async () => {
			// GIVEN a row already linked with one citation
			const runId = await seedRun()
			const subjectId = randomUUID()
			await link(runId, subjectId, [{ source_id: 'src_old' }])

			// WHEN the same run applies it again with new citations
			await link(runId, subjectId, [{ source_id: 'src_new' }])

			// THEN there is still one link, holding the latest citations
			const rows = await pool.query<{ citations: Citation[] }>(
				`SELECT citations FROM research_links
				 WHERE research_id = $1 AND subject_id = $2`,
				[runId, subjectId],
			)
			expect(rows.rows).toHaveLength(1)
			expect(rows.rows[0]?.citations).toEqual([{ source_id: 'src_new' }])
		})
	})

	describe('when the row was the run’s input subject', () => {
		it('should keep the input link kind while recording citations', async () => {
			// GIVEN an existing input link (the run researched this subject)
			const runId = await seedRun()
			const subjectId = randomUUID()
			await pool.query(
				`INSERT INTO research_links
					(organization_id, research_id, subject_table, subject_id, link_kind)
				 VALUES ($1, $2, 'companies', $3, 'input')`,
				[ORG, runId, subjectId],
			)

			// WHEN a finding is applied to that same subject
			await link(runId, subjectId, [{ source_id: 'src_x' }], 'companies')

			// THEN the link stays an input link but now carries the citations
			const rows = await pool.query<{
				link_kind: string
				citations: Citation[]
			}>(
				`SELECT link_kind, citations FROM research_links
				 WHERE research_id = $1 AND subject_id = $2`,
				[runId, subjectId],
			)
			expect(rows.rows).toHaveLength(1)
			expect(rows.rows[0]?.link_kind).toBe('input')
			expect(rows.rows[0]?.citations).toEqual([{ source_id: 'src_x' }])
		})
	})
})

describe('researchProvenance', () => {
	describe('when a row was written by a run citing a known source', () => {
		it('should resolve the run, its date, and the source URL', async () => {
			// GIVEN a run that cited a real source when writing a contact
			const completedAt = '2026-06-01T10:00:00Z'
			const runId = await seedRun(ORG, completedAt)
			const sourceId = await seedSource('https://acme.example.com/team')
			const subjectId = randomUUID()
			await link(runId, subjectId, [{ source_id: sourceId }])

			// WHEN the contact's provenance is read
			const result = await provenance(subjectId)

			// THEN it points at the run and resolves the source URL
			expect(result).toHaveLength(1)
			expect(result[0]?.runId).toBe(runId)
			expect(result[0]?.sources).toEqual([
				{ sourceId, url: 'https://acme.example.com/team' },
			])
		})
	})

	describe('when a citation points at a source that is gone', () => {
		it('should still return the run but omit the missing source', async () => {
			// GIVEN a link citing a source id that no longer exists
			const runId = await seedRun(ORG, '2026-06-02T10:00:00Z')
			const subjectId = randomUUID()
			await link(runId, subjectId, [{ source_id: 'src_missing' }])

			// WHEN provenance is read
			const result = await provenance(subjectId)

			// THEN the run is still traceable, with no resolvable source
			expect(result).toHaveLength(1)
			expect(result[0]?.sources).toEqual([])
		})
	})

	describe('when the row has no research links', () => {
		it('should return an empty trail', async () => {
			// GIVEN a subject no run ever wrote
			const subjectId = randomUUID()

			// WHEN provenance is read
			const result = await provenance(subjectId)

			// THEN there is nothing to show
			expect(result).toEqual([])
		})
	})

	describe('when more than one run wrote the row', () => {
		it('should list the most recently completed run first', async () => {
			// GIVEN two runs that both wrote the same contact
			const subjectId = randomUUID()
			const olderRun = await seedRun(ORG, '2026-05-01T10:00:00Z')
			const newerRun = await seedRun(ORG, '2026-05-10T10:00:00Z')
			await link(olderRun, subjectId, [])
			await link(newerRun, subjectId, [])

			// WHEN provenance is read
			const result = await provenance(subjectId)

			// THEN the newest run leads
			expect(result.map(r => r.runId)).toEqual([newerRun, olderRun])
		})
	})

	describe('when the link belongs to another organization', () => {
		it('should not surface it', async () => {
			// GIVEN a provenance link in another org
			const runId = await seedRun(OTHER_ORG, '2026-06-03T10:00:00Z')
			const subjectId = randomUUID()
			await link(
				runId,
				subjectId,
				[{ source_id: 'src_o' }],
				'contacts',
				OTHER_ORG,
			)

			// WHEN this org reads that subject's provenance
			const result = await provenance(subjectId)

			// THEN the other org's trail is invisible
			expect(result).toEqual([])
		})
	})
})
