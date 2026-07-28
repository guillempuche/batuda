// The retention window is read via Config at layer-build time; 0 days makes the
// sweep prune everything already completed, so the fixtures are pruned in one
// pass.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_RETENTION_DAYS'] = '0'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { ResearchRetention } from './research-retention'
import { StorageProvider } from './storage-provider'

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `ret-org-${randomUUID()}`

let pool: pg.Pool
const deletedBlobs: string[] = []

const storageStub = Layer.succeed(StorageProvider)(
	StorageProvider.of({
		put: () => Effect.die('unused'),
		get: () => Effect.die('unused'),
		delete: key =>
			Effect.sync(() => {
				deletedBlobs.push(key)
			}),
		head: () => Effect.die('unused'),
		signedUrl: () => Effect.die('unused'),
	}),
)

const deps = ResearchRetention.layer.pipe(
	Layer.provide(storageStub),
	Layer.provideMerge(PgLive),
)

const sweep = () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const retention = yield* ResearchRetention
			return yield* retention.sweepExpired()
		}).pipe(Effect.provide(deps)) as Effect.Effect<
			{ orphanBlobs: number; seenOnly: number },
			never,
			never
		>,
	)

// Unique keys/ids so assertions only see this suite's fixtures.
const searchKey = `ret-search-${randomUUID()}`
const llmKey = `ret-llm-${randomUUID()}`
const runSourceId = `src_run_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const orphanSourceId = `src_orphan_${randomUUID().replace(/-/g, '').slice(0, 10)}`
const citedSourceId = `src_cited_${randomUUID().replace(/-/g, '').slice(0, 11)}`
// Pages a run only saw named: one nothing points at, one a run lists among what
// it read, and one an applied change cites by address rather than by record id.
const seenOrphanId = `src_seen_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const seenLinkedId = `src_seenrun_${randomUUID().replace(/-/g, '').slice(0, 9)}`
const seenCitedByUrlId = `src_seenurl_${randomUUID().replace(/-/g, '').slice(0, 9)}`
let runId = ''

// `contentRef` null means a page the run only saw named, never stored — the
// shape a search result and a register lookup leave behind.
const seedSource = (id: string, contentRef: string | null) =>
	pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash, content_ref, last_fetched_at)
		 VALUES ($1, 'web', 'test', $2, $3, 'example.com', 'chash', $4, now() - interval '1 day')`,
		[id, `https://x/${id}`, `hash_${id}`, contentRef],
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })

	// Expired caches (search + llm by expires_at).
	await pool.query(
		`INSERT INTO search_cache (key_hash, provider, query, items, expires_at)
		 VALUES ($1, 'p', 'q', '[]'::jsonb, now() - interval '1 hour')`,
		[searchKey],
	)
	await pool.query(
		`INSERT INTO llm_cache (key_hash, tier, model, prompt_preview, response, expires_at)
		 VALUES ($1, 'agent', 'm', 'p', '{}'::jsonb, now() - interval '1 hour')`,
		[llmKey],
	)

	// A completed run with a bulky transcript and a fetched source.
	const run = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, research_text, tool_log, completed_at)
		 VALUES ($1, 'q', 'succeeded', 'u1', 'long transcript', '[{"t":1}]'::jsonb, now() - interval '10 days')
		 RETURNING id`,
		[ORG],
	)
	runId = run.rows[0]!.id
	await seedSource(runSourceId, `scrape/run-${randomUUID()}`)
	await pool.query(
		`INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref)
		 VALUES ($1, $2, $3, 'ref')`,
		[ORG, runId, runSourceId],
	)

	// An orphaned source: no run fetches it, no contact cites it.
	await seedSource(orphanSourceId, `scrape/orphan-${randomUUID()}`)

	// A source cited by an applied contact's provenance link — must be kept.
	await seedSource(citedSourceId, `scrape/cited-${randomUUID()}`)
	await pool.query(
		`INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind, citations)
		 VALUES ($1, $2, 'contacts', $3, 'finding', $4::jsonb)`,
		[ORG, runId, randomUUID(), JSON.stringify([{ source_id: citedSourceId }])],
	)

	// A page only ever seen named, that nothing points at.
	await seedSource(seenOrphanId, null)

	// A page only ever seen named, but listed among what a run read.
	await seedSource(seenLinkedId, null)
	await pool.query(
		`INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref)
		 VALUES ($1, $2, $3, 'ref')`,
		[ORG, runId, seenLinkedId],
	)

	// A page only ever seen named, cited by its address rather than its record
	// id — which is how the model is asked to cite, so this is the ordinary
	// shape, not an odd one.
	await seedSource(seenCitedByUrlId, null)
	await pool.query(
		`INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind, citations)
		 VALUES ($1, $2, 'contacts', $3, 'finding', $4::jsonb)`,
		[
			ORG,
			runId,
			randomUUID(),
			JSON.stringify([{ source_id: `https://x/${seenCitedByUrlId}` }]),
		],
	)
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM sources WHERE id = ANY($1::text[])`, [
		[
			runSourceId,
			orphanSourceId,
			citedSourceId,
			seenOrphanId,
			seenLinkedId,
			seenCitedByUrlId,
		],
	])
	await pool.query(`DELETE FROM search_cache WHERE key_hash = $1`, [searchKey])
	await pool.query(`DELETE FROM llm_cache WHERE key_hash = $1`, [llmKey])
	await pool.end()
})

const exists = async (table: string, col: string, value: string) => {
	const r = await pool.query(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [
		value,
	])
	return r.rows.length > 0
}

describe('research retention sweep', () => {
	it('should prune expired caches, old transcripts, and unwanted sources while keeping provenance', async () => {
		// GIVEN expired caches, an old run with a transcript + sources, an
		// orphaned source, a cited source, and three pages only ever seen named
		// (all seeded above)
		// WHEN the sweep runs
		const result = await sweep()

		// THEN every expired cache row is gone
		expect(await exists('search_cache', 'key_hash', searchKey)).toBe(false)
		expect(await exists('llm_cache', 'key_hash', llmKey)).toBe(false)

		// AND the old run keeps its row but sheds its bulky transcript
		const run = await pool.query<{
			research_text: string | null
			tool_log: unknown[]
		}>(`SELECT research_text, tool_log FROM research_runs WHERE id = $1`, [
			runId,
		])
		expect(run.rows[0]?.research_text).toBeNull()
		expect(run.rows[0]?.tool_log).toEqual([])

		// AND a source a run still references survives
		expect(await exists('sources', 'id', runSourceId)).toBe(true)

		// AND an orphaned source is deleted, its blob removed
		expect(await exists('sources', 'id', orphanSourceId)).toBe(false)
		expect(deletedBlobs.some(k => k.startsWith('scrape/orphan-'))).toBe(true)

		// AND a source cited by a contact's provenance is kept — the trail holds
		expect(await exists('sources', 'id', citedSourceId)).toBe(true)
		expect(deletedBlobs.some(k => k.startsWith('scrape/cited-'))).toBe(false)

		// AND among the pages only ever seen named, never stored: the one nothing
		// points at is forgotten, and no stored copy was looked for, because there
		// was never one to delete
		expect(result.seenOnly).toBeGreaterThan(0)
		expect(await exists('sources', 'id', seenOrphanId)).toBe(false)
		expect(deletedBlobs.some(k => k.includes(seenOrphanId))).toBe(false)

		// AND the one a run lists among what it read survives
		expect(await exists('sources', 'id', seenLinkedId)).toBe(true)

		// AND so does the one cited by its address rather than its record id. The
		// model is asked to cite the address it read, so that is the ordinary
		// shape — missing it would quietly break the trail behind an applied change
		expect(await exists('sources', 'id', seenCitedByUrlId)).toBe(true)
	})
})
