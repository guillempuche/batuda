// Live-DB integration test for what an apply records about a company beyond the
// proposed values: where each value came from, the run's fit judgement, and the
// written brief. All three are decided inside the one UPDATE statement, against
// the row as it stands at write time, so only a real database can prove they
// behave.
//
// The rule these cases hold to is written out in docs/architecture.md, under
// "What an apply writes". Changing what happens here means changing it there.
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
import { occUpdate } from './research-apply'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)
const ORG = `enrich-org-${randomUUID()}`
// The run each stored provenance entry credits; these cases exercise how the
// entries merge, so one run id for all of them is enough.
const RUN_ID = randomUUID()

// A second runtime carrying the company service, so a test can edit a company
// the way a person does in the app rather than by writing SQL behind its back.
const serviceRuntime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

const personEdits = (id: string, fields: Record<string, unknown>) =>
	serviceRuntime.runPromise(
		Effect.gen(function* () {
			const svc = yield* CompanyService
			return yield* svc.update(id, fields)
		}).pipe(
			Effect.provideService(CurrentOrg, {
				id: ORG,
				name: 'b',
				slug: 'b',
				role: 'member',
			}),
		),
	)

let pool: pg.Pool

const seedCompany = async (): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[ORG, `acme-${randomUUID()}`],
	)
	return r.rows[0]?.id ?? ''
}

type CompanyRow = {
	account_brief: string | null
	last_enriched_at: Date | null
	field_provenance: Record<string, { sourceUrl: string; runId: string }> | null
	industry: string | null
	fit_verdict: string | null
	fit_checks: unknown
	fit_conflicts: unknown
	version: number
}

const readCompany = async (id: string): Promise<CompanyRow> => {
	const r = await pool.query<CompanyRow>(
		`SELECT account_brief, last_enriched_at, industry,
		        field_provenance, fit_verdict, fit_checks, fit_conflicts, version
		 FROM companies WHERE id = $1`,
		[id],
	)
	return r.rows[0] as CompanyRow
}

// Apply one update the way the resolve path does, with whatever the run learned.
const apply = (
	id: string,
	version: number,
	fields: Record<string, unknown>,
	enrichment: Parameters<typeof occUpdate>[6],
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* occUpdate(
				sql,
				'companies',
				id,
				ORG,
				version,
				fields,
				enrichment,
			)
		}),
	)

// The same write, aimed at whichever table — the record a person keeps of where
// each fact came from is the point of the cases below.
const applyTo = (
	table: 'companies' | 'contacts',
	id: string,
	version: number,
	fields: Record<string, unknown>,
	enrichment: Parameters<typeof occUpdate>[6],
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* occUpdate(sql, table, id, ORG, version, fields, enrichment)
		}),
	)

const noRunFacts = {
	isRunTarget: false,
	fitVerdict: null,
	fitChecks: null,
	fitConflicts: null,
	brief: null,
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
	await runtime.dispose()
	await serviceRuntime.dispose()
})

describe('occUpdate, on the enrichment it records for a company', () => {
	describe('when a later run fills a field an earlier run did not', () => {
		it('should keep both sources, not replace the earlier one', async () => {
			// GIVEN a company whose industry a first run sourced to its about page
			const id = await seedCompany()
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					...noRunFacts,
					provenance: {
						industry: {
							sourceUrl: 'https://acme.es/about',
							runId: RUN_ID,
							confidence: 0.9,
						},
					},
				},
			)

			// WHEN a second run fills only the location, from a different page
			await apply(
				id,
				1,
				{ location: 'Girona' },
				{
					...noRunFacts,
					provenance: {
						location: { sourceUrl: 'https://acme.es/contact', runId: RUN_ID },
					},
				},
			)

			// THEN the industry still says where it came from — the box was added to
			const row = await readCompany(id)
			expect(row.field_provenance?.['industry']?.sourceUrl).toBe(
				'https://acme.es/about',
			)
			expect(row.field_provenance?.['location']?.sourceUrl).toBe(
				'https://acme.es/contact',
			)
		})
	})

	describe('when an update carries no provenance at all', () => {
		it('should leave the stored sources untouched', async () => {
			// GIVEN a company with a recorded source
			const id = await seedCompany()
			await apply(
				id,
				0,
				{ industry: 'retail' },
				{
					...noRunFacts,
					provenance: {
						industry: { sourceUrl: 'https://acme.es/about', runId: RUN_ID },
					},
				},
			)

			// WHEN a plain field edit lands with nothing to say about sources
			await apply(
				id,
				1,
				{ location: 'Salt' },
				{ ...noRunFacts, provenance: {} },
			)

			// THEN the earlier source survives
			const row = await readCompany(id)
			expect(row.field_provenance?.['industry']?.sourceUrl).toBe(
				'https://acme.es/about',
			)
		})
	})

	describe('when the company has no brief yet', () => {
		it("should write the run's brief, and stamp the fit and freshness", async () => {
			// GIVEN a company nobody has written notes for
			const id = await seedCompany()

			// WHEN the run it was about is applied
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'strong_fit',
					fitChecks: [{ criterion: 'asset carrier', result: 'pass' }],
					fitConflicts: null,
					brief: '## Acme — 2026-07-23\n\nA carrier.',
				},
			)

			// THEN the brief is the run's, and the judgement came with it
			const row = await readCompany(id)
			expect(row.account_brief).toBe('## Acme — 2026-07-23\n\nA carrier.')
			expect(row.fit_verdict).toBe('strong_fit')
			expect(row.last_enriched_at).not.toBeNull()
		})
	})

	describe('when a person has already written the brief', () => {
		it('should replace their text rather than adding underneath it', async () => {
			// GIVEN notes a person wrote
			const id = await seedCompany()
			await pool.query(
				`UPDATE companies SET account_brief = $2 WHERE id = $1`,
				[id, 'My own notes.'],
			)

			// WHEN a run about this company is applied
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'possible_fit',
					fitChecks: null,
					fitConflicts: null,
					brief: '## Acme — 2026-07-23\n\nStill a carrier.',
				},
			)

			// THEN the run's text is the whole brief
			const row = await readCompany(id)
			expect(row.account_brief).toBe('## Acme — 2026-07-23\n\nStill a carrier.')
		})
	})

	describe('when a run has nothing to say about the brief', () => {
		it("should leave the person's text alone", async () => {
			// GIVEN notes a person wrote
			const id = await seedCompany()
			await pool.query(
				`UPDATE companies SET account_brief = $2 WHERE id = $1`,
				[id, 'My own notes.'],
			)

			// WHEN a run that produced no brief is applied
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'possible_fit',
					fitChecks: null,
					fitConflicts: null,
					brief: null,
				},
			)

			// THEN the notes are exactly as they left them
			const row = await readCompany(id)
			expect(row.account_brief).toBe('My own notes.')
		})
	})

	// The writer model sometimes hands back nothing but its own reasoning, which
	// strips to blank. Both warnings a person gets before an apply read that as no
	// brief, so a write here would take their notes with nothing having said so.
	describe('when the run wrote a brief that came back empty', () => {
		it("should leave a person's notes where they are", async () => {
			// GIVEN notes a person wrote
			const id = await seedCompany()
			await personEdits(id, {
				accountBrief: 'Met them at the fair. Ask for Mar.',
			})

			// WHEN a run whose brief came back blank is applied with somebody watching
			await apply(
				id,
				1,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					attended: true,
					fitVerdict: null,
					fitChecks: null,
					fitConflicts: null,
					brief: '   ',
				},
			)

			// THEN their notes are exactly as they left them
			const row = await readCompany(id)
			expect(row.account_brief).toBe('Met them at the fair. Ask for Mar.')
			// AND the value the run did check still landed
			expect(row.industry).toBe('transport')
		})
	})

	// The fit rules a run checks come back as one row per rule. A run that listed
	// none judged nothing, so it must not wipe what an earlier one found.
	describe('when a later run lists no fit rules at all', () => {
		it('should keep the rules an earlier run checked', async () => {
			// GIVEN a company an earlier run judged rule by rule
			const id = await seedCompany()
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'strong_fit',
					fitChecks: [{ criterion: 'asset carrier', result: 'pass' }],
					fitConflicts: null,
					brief: null,
				},
			)

			// WHEN a later run judges the company but lists no rules
			await apply(
				id,
				1,
				{ industry: 'logistics' },
				{
					provenance: {},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'possible_fit',
					fitChecks: [],
					fitConflicts: null,
					brief: null,
				},
			)

			// THEN the earlier rules are still there
			const row = await readCompany(id)
			expect(row.fit_checks).toEqual([
				{ criterion: 'asset carrier', result: 'pass' },
			])
			// AND the later run's own verdict did land
			expect(row.fit_verdict).toBe('possible_fit')
		})
	})

	describe('when the company is one the run merely mentioned', () => {
		it('should record its sources but none of the run-level judgement', async () => {
			// GIVEN a competitor the run named, not the company it researched
			const id = await seedCompany()

			// WHEN its values are applied with isRunTarget false
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {
						industry: { sourceUrl: 'https://rival.es', runId: RUN_ID },
					},
					isRunTarget: false,
					fitVerdict: 'strong_fit',
					fitChecks: [{ criterion: 'x', result: 'pass' }],
					fitConflicts: null,
					brief: '## Rival\n\nShould not land.',
				},
			)

			// THEN only the per-field sources landed
			const row = await readCompany(id)
			expect(row.field_provenance?.['industry']?.sourceUrl).toBe(
				'https://rival.es',
			)
			expect(row.account_brief).toBeNull()
			expect(row.fit_verdict).toBeNull()
			expect(row.last_enriched_at).toBeNull()
		})
	})

	// The run's judgement and its written notes are the two things on a company
	// that nobody can check by machine, so they are the two an apply nobody
	// watched has to leave alone. Everything else it found still lands.
	describe('when nobody was looking as the apply landed', () => {
		it("should leave a person's notes exactly as they wrote them", async () => {
			// GIVEN notes a person wrote
			const id = await seedCompany()
			await personEdits(id, {
				accountBrief: 'Met them at the fair. Ask for Mar.',
			})
			const before = await readCompany(id)

			// WHEN the server applies a finding on its own
			await apply(
				id,
				before.version,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					fitVerdict: 'strong_fit',
					fitChecks: null,
					fitConflicts: null,
					brief: '## Acme — 2026-08-25\n\nWritten by the run.',
				},
			)

			// THEN their text is still there, word for word
			const row = await readCompany(id)
			expect(row.account_brief).toBe('Met them at the fair. Ask for Mar.')
		})

		it('should leave the fit judgement as it stood', async () => {
			// GIVEN a company already judged a weak fit
			const id = await seedCompany()
			await apply(
				id,
				0,
				{},
				{
					provenance: {},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'weak_fit',
					fitChecks: [{ criterion: 'size', result: 'fail' }],
					fitConflicts: [{ field: 'employee_count', note: 'two figures' }],
					brief: null,
				},
			)

			// WHEN a later run applies on its own, judging it differently
			await apply(
				id,
				1,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					fitVerdict: 'strong_fit',
					fitChecks: [{ criterion: 'size', result: 'pass' }],
					fitConflicts: null,
					brief: null,
				},
			)

			// THEN the earlier verdict, its checks and its conflicts all stand
			const row = await readCompany(id)
			expect(row.fit_verdict).toBe('weak_fit')
			expect(row.fit_checks).toEqual([{ criterion: 'size', result: 'fail' }])
			expect(row.fit_conflicts).toEqual([
				{ field: 'employee_count', note: 'two figures' },
			])
		})

		it('should still write the value, where it came from, and the freshness stamp', async () => {
			// GIVEN a company with nothing filled in
			const id = await seedCompany()

			// WHEN the server applies a finding on its own
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {
						industry: { sourceUrl: 'https://acme.es', runId: RUN_ID },
					},
					isRunTarget: true,
					fitVerdict: 'strong_fit',
					fitChecks: null,
					fitConflicts: null,
					brief: '## Acme\n\nShould not land.',
				},
			)

			// THEN the value landed, carrying the page it came from
			const row = await readCompany(id)
			expect(row.industry).toBe('transport')
			expect(row.field_provenance?.['industry']?.sourceUrl).toBe(
				'https://acme.es',
			)
			// AND the row counts as freshly researched, which is what tells a
			// later reader anything was learned about it at all
			expect(row.last_enriched_at).not.toBeNull()
		})
	})

	describe('when nobody was looking and the company has no notes yet', () => {
		it('should leave the page blank rather than filling it', async () => {
			// GIVEN a company nobody has written notes for
			const id = await seedCompany()

			// WHEN the server applies a finding on its own
			await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {},
					isRunTarget: true,
					fitVerdict: null,
					fitChecks: null,
					fitConflicts: null,
					brief: '## Acme — 2026-08-25\n\nWritten by the run.',
				},
			)

			// THEN nothing was written there — an empty page is not an invitation
			const row = await readCompany(id)
			expect(row.account_brief).toBeNull()
		})
	})

	describe('when the row moved on since the proposal was made', () => {
		it('should land nothing, so a stale enrichment cannot overwrite', async () => {
			// GIVEN a company already at version 1
			const id = await seedCompany()
			await apply(
				id,
				0,
				{ industry: 'retail' },
				{ ...noRunFacts, provenance: {} },
			)

			// WHEN an update made against version 0 arrives late
			const rows = await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {
						industry: { sourceUrl: 'https://stale.es', runId: RUN_ID },
					},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'no_fit',
					fitChecks: null,
					fitConflicts: null,
					brief: '## Stale',
				},
			)

			// THEN nothing was written at all
			expect(rows.length).toBe(0)
			const row = await readCompany(id)
			expect(row.industry ?? null).not.toBe('transport')
			expect(row.account_brief).toBeNull()
			expect(row.field_provenance?.['industry']?.sourceUrl).not.toBe(
				'https://stale.es',
			)
		})
	})
	describe('when a person edits the company while a run is still thinking', () => {
		it("should move the row on, so the run's findings cannot overwrite the edit", async () => {
			// GIVEN a company a run has just read, at the version its proposal was
			// made against
			const id = await seedCompany()

			// WHEN a person writes their own notes before the run's apply lands
			await personEdits(id, { accountBrief: 'My notes.' })

			// THEN the apply, still aimed at the version it saw, writes nothing
			const rows = await apply(
				id,
				0,
				{ industry: 'transport' },
				{
					provenance: {
						industry: { sourceUrl: 'https://acme.es', runId: RUN_ID },
					},
					isRunTarget: true,
					attended: true,
					fitVerdict: 'strong_fit',
					fitChecks: null,
					fitConflicts: null,
					brief: '## Acme\n\nResearch text.',
				},
			)
			expect(rows.length).toBe(0)

			// AND the person's notes are exactly as they left them
			const row = await readCompany(id)
			expect(row.account_brief).toBe('My notes.')
		})
	})
})

describe('the record a person keeps of where each fact came from', () => {
	const seedPerson = async (companyId: string): Promise<string> => {
		const r = await pool.query<{ id: string }>(
			`INSERT INTO contacts (organization_id, company_id, name)
			 VALUES ($1, $2, 'Dolors Puig') RETURNING id`,
			[ORG, companyId],
		)
		return r.rows[0]!.id
	}

	const provenanceOf = async (contactId: string) =>
		(
			await pool.query<{
				field_provenance: Record<
					string,
					{ sourceUrl: string; asOf?: string }
				> | null
			}>(`SELECT field_provenance FROM contacts WHERE id = $1`, [contactId])
		).rows[0]?.field_provenance ?? null

	describe('when a run fills a job title from a dated page', () => {
		it('should record the page and the date it was true as of', async () => {
			// GIVEN a person on file with nothing said about where their details
			// came from
			const companyId = await seedCompany()
			const contactId = await seedPerson(companyId)
			expect(await provenanceOf(contactId)).toBeNull()

			// WHEN a run writes their title, citing a page that dates it
			await applyTo(
				'contacts',
				contactId,
				0,
				{ role: 'Plant Manager' },
				{
					provenance: {
						role: {
							sourceUrl: 'https://acme.es/team',
							runId: RUN_ID,
							asOf: '2026-03',
						},
					},
				},
			)

			// THEN the person answers "where did this title come from, and when was
			// it true?" — which only a company could do before
			const stored = await provenanceOf(contactId)
			expect(stored?.['role']?.sourceUrl).toBe('https://acme.es/team')
			expect(stored?.['role']?.asOf).toBe('2026-03')
		})

		it('should leave an earlier field alone when a later run fills another', async () => {
			// GIVEN a person whose title already says where it came from
			const companyId = await seedCompany()
			const contactId = await seedPerson(companyId)
			await applyTo(
				'contacts',
				contactId,
				0,
				{ role: 'Plant Manager' },
				{
					provenance: {
						role: { sourceUrl: 'https://acme.es/team', runId: RUN_ID },
					},
				},
			)

			// WHEN a later run corrects the name from somewhere else
			await applyTo(
				'contacts',
				contactId,
				1,
				{ name: 'Dolors Puig i Roca' },
				{
					provenance: {
						name: { sourceUrl: 'https://acme.es/about', runId: RUN_ID },
					},
				},
			)

			// THEN both are on file — the box was added to, not replaced
			const stored = await provenanceOf(contactId)
			expect(stored?.['role']?.sourceUrl).toBe('https://acme.es/team')
			expect(stored?.['name']?.sourceUrl).toBe('https://acme.es/about')
		})
	})
})
