// Live-DB integration test for a run's attribute values landing on the company
// the run was about when a person applies its findings. The values are checked
// against what the organisation declares at apply time, held to the pages the
// run fetched, and never written over a value a person set by hand — all
// decided against the row as it stands, so only a real database can show it.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import { makeWorkRecord, WorkRecord } from '@batuda/observability'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { Geocoder } from './geocoder'
import {
	type ApplyOrigin,
	resolveResearchProposedUpdate,
} from './research-apply'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const suffix = randomUUID().slice(0, 8)
const ORG = `apply-attr-${suffix}`
const SITES = `sites_${suffix}`
const CRM = `crm_${suffix}`
const PAGE = `https://acme.example/${suffix}/about`

let pool: pg.Pool

const deps = Layer.mergeAll(
	TimelineActivityService.layer,
	CompanyService.layer,
	Geocoder.layer,
).pipe(Layer.provide(FetchHttpClient.layer), Layer.provideMerge(PgLive))

const apply = (
	runId: string,
	proposalId: string,
	origin: ApplyOrigin = 'person',
) =>
	resolveResearchProposedUpdate(runId, proposalId, 'apply', null, {
		origin,
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

// The same, with the request's record open, so a test can read what the
// apply wrote on it.
const applyRecorded = (runId: string, proposalId: string) =>
	Effect.gen(function* () {
		const record = yield* makeWorkRecord
		const outcome = yield* resolveResearchProposedUpdate(
			runId,
			proposalId,
			'apply',
			null,
			{ origin: 'person' },
		).pipe(Effect.provideService(WorkRecord, record))
		return { outcome, facts: yield* record.read }
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

const seedCompany = async (
	attributes: Record<string, unknown> = {},
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, attributes)
		 VALUES ($1, $2, 'Acme', $3::jsonb) RETURNING id`,
		[ORG, `acme-${randomUUID()}`, JSON.stringify(attributes)],
	)
	return r.rows[0]?.id as string
}

// A succeeded run about `companyId`, whose findings carry the attribute map
// (built around the run's own id for the page it fetched, `PAGE`) and one
// proposed change.
const seedRun = async (args: {
	readonly companyId: string
	readonly attributes: (srcId: string) => Record<string, unknown>
	readonly fields?: Record<string, unknown>
	readonly aboutCompany?: boolean
}): Promise<{ runId: string; proposalId: string }> => {
	const proposalId = randomUUID()
	const srcId = `src_${randomUUID().slice(0, 8)}`
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'test', $2, $3, 'acme.example', $4)`,
		[srcId, PAGE, `hash-${randomUUID()}`, `content-${randomUUID()}`],
	)
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, findings, context)
		 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb, $3::jsonb) RETURNING id`,
		[
			ORG,
			JSON.stringify({
				attributes: args.attributes(srcId),
				proposed_updates: [
					{
						id: proposalId,
						status: 'pending',
						subject_table: 'companies',
						operation: 'update',
						subject_id: args.companyId,
						expected_version: 0,
						fields: args.fields ?? {},
						citations: [],
					},
				],
			}),
			JSON.stringify(
				args.aboutCompany === false
					? {}
					: { subjects: [{ table: 'companies', id: args.companyId }] },
			),
		],
	)
	const runId = r.rows[0]?.id as string
	await pool.query(
		`INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents)
		 VALUES ($1, $2, $3, $4, now(), 0)`,
		[ORG, runId, srcId, PAGE],
	)
	return { runId, proposalId }
}

const readRow = async (id: string) => {
	const r = await pool.query<{
		attributes: Record<string, unknown>
		field_provenance: Record<string, unknown> | null
		version: number
	}>(
		`SELECT attributes, field_provenance, version FROM companies WHERE id = $1`,
		[id],
	)
	return r.rows[0] as NonNullable<(typeof r.rows)[0]>
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	const stack = await pool.query<{ id: string }>(
		`INSERT INTO instruction_stacks (organization_id, owner_user_id, agent, name, is_default)
		 VALUES ($1, NULL, 'research', $2, true) RETURNING id`,
		[ORG, `st-${suffix}`],
	)
	const stackId = stack.rows[0]?.id
	await pool.query(
		`INSERT INTO research_attributes (organization_id, stack_id, key, label, kind, unit, created_by)
		 VALUES ($1, $2, $3, 'Sites', 'number', 'sites', 'u1'), ($1, $2, $4, 'CRM', 'text', NULL, 'u1')`,
		[ORG, stackId, SITES, CRM],
	)
})

afterAll(async () => {
	await pool.query(`DELETE FROM timeline_activity WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(
		`DELETE FROM research_run_sources WHERE organization_id = $1`,
		[ORG],
	)
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.query(
		`DELETE FROM instruction_stacks WHERE organization_id = $1`,
		[ORG],
	)
	await pool.query(`DELETE FROM sources WHERE url = $1`, [PAGE])
	await pool.end()
})

describe("landing a run's attribute values on apply", () => {
	describe('when a person applies a proposal that carries only attributes', () => {
		it('should apply it, merging the values with their page, the run and a note', async () => {
			// GIVEN a company already holding another key, and a run that found
			// two grounded values for it
			const companyId = await seedCompany({
				other: { value: 'x', set_by: 'client' },
			})
			const { runId, proposalId } = await seedRun({
				companyId,
				attributes: srcId => ({
					[SITES]: {
						value: '3',
						source_id: srcId,
						quote: 'three sites',
						as_of: '2026-01-02',
					},
					[CRM]: { value: 'zoho', source_id: srcId },
				}),
			})

			// WHEN a person applies it
			const outcome = await apply(runId, proposalId)

			// THEN it applied, the values merged beside the other key, stamped as
			// the run's, with a note of where each came from
			expect(outcome.outcome).toBe('applied')
			const row = await readRow(companyId)
			expect(row.attributes).toEqual({
				other: { value: 'x', set_by: 'client' },
				[SITES]: {
					value: 3,
					source_url: PAGE,
					quote: 'three sites',
					as_of: '2026-01-02',
					research_id: runId,
					set_by: 'research',
				},
				[CRM]: {
					value: 'zoho',
					source_url: PAGE,
					research_id: runId,
					set_by: 'research',
				},
			})
			expect(row.field_provenance).toEqual({
				[`attributes.${SITES}`]: { sourceUrl: PAGE, runId, asOf: '2026-01-02' },
				[`attributes.${CRM}`]: { sourceUrl: PAGE, runId },
			})
			expect(row.version).toBe(1)
		})
	})

	describe('when the values cannot land', () => {
		it('should drop an undeclared, an ungrounded and an unfetched-page value, and apply nothing', async () => {
			// GIVEN one of each
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun({
				companyId,
				attributes: srcId => ({
					nobody_declared: { value: 1, source_id: srcId },
					[SITES]: 3,
					[CRM]: { value: 'zoho', source_id: 'https://never.example/opened' },
				}),
			})

			// WHEN applied
			const outcome = await apply(runId, proposalId)

			// THEN nothing was applicable and the column is untouched
			expect(outcome.outcome).toBe('no_applicable_fields')
			expect((await readRow(companyId)).attributes).toEqual({})
		})
	})

	describe('when the row already holds a key a person set', () => {
		it("should keep the person's value and not count it as applied", async () => {
			// GIVEN a person's value under the key the run also found
			const companyId = await seedCompany({
				[SITES]: { value: 9, set_by: 'client' },
			})
			const { runId, proposalId } = await seedRun({
				companyId,
				attributes: srcId => ({
					[SITES]: { value: 3, source_id: srcId },
					[CRM]: { value: 'zoho', source_id: srcId },
				}),
			})

			// WHEN applied
			const outcome = await apply(runId, proposalId)

			// THEN the other key landed and the person's stayed, with no note for it
			expect(outcome.outcome).toBe('applied')
			const row = await readRow(companyId)
			expect(row.attributes[SITES]).toEqual({ value: 9, set_by: 'client' })
			expect(row.attributes[CRM]).toMatchObject({
				value: 'zoho',
				set_by: 'research',
			})
			expect(row.field_provenance).toEqual({
				[`attributes.${CRM}`]: { sourceUrl: PAGE, runId },
			})
		})
	})

	describe('when the server applies on its own', () => {
		it('should leave the attributes alone, so an attributes-only proposal has nothing to apply', async () => {
			// GIVEN a grounded value and an unattended apply
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun({
				companyId,
				attributes: srcId => ({ [SITES]: { value: 3, source_id: srcId } }),
			})

			// WHEN applied without a person
			const outcome = await apply(runId, proposalId, 'unattended')

			// THEN nothing applies
			expect(outcome.outcome).toBe('no_applicable_fields')
			expect((await readRow(companyId)).attributes).toEqual({})
		})
	})

	describe('when the proposal is about a company the run merely mentioned', () => {
		it('should land the ordinary fields and no attributes', async () => {
			// GIVEN a run not pinned to the company, proposing a field and carrying values
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun({
				companyId,
				aboutCompany: false,
				fields: { industry: 'transport' },
				attributes: srcId => ({ [SITES]: { value: 3, source_id: srcId } }),
			})

			// WHEN applied
			const outcome = await apply(runId, proposalId)

			// THEN the field landed and the attributes did not
			expect(outcome.outcome).toBe('applied')
			expect((await readRow(companyId)).attributes).toEqual({})
		})
	})

	describe('when the run was about two companies at once', () => {
		it('should land the ordinary fields and no attributes, since the values belong to neither', async () => {
			// GIVEN a run pinned to two companies, with a grounded value
			const companyId = await seedCompany()
			const other = await seedCompany()
			const { runId, proposalId } = await seedRun({
				companyId,
				fields: { industry: 'transport' },
				attributes: srcId => ({ [SITES]: { value: 3, source_id: srcId } }),
			})
			await pool.query(
				`UPDATE research_runs SET context = $2::jsonb WHERE id = $1`,
				[
					runId,
					JSON.stringify({
						subjects: [
							{ table: 'companies', id: companyId },
							{ table: 'companies', id: other },
						],
					}),
				],
			)

			// WHEN applied to one of them
			const outcome = await apply(runId, proposalId)

			// THEN the field landed and the attributes did not
			expect(outcome.outcome).toBe('applied')
			expect((await readRow(companyId)).attributes).toEqual({})
		})
	})

	describe("when the outcome goes on the request's record", () => {
		it('should count what landed, what a person held back and what was dropped', async () => {
			// GIVEN a person's own value under one key, and a run with a value for
			// it, a value for another key, and one under a key nobody declared
			const companyId = await seedCompany({
				[CRM]: { value: 'mine', set_by: 'client' },
			})
			const { runId, proposalId } = await seedRun({
				companyId,
				attributes: srcId => ({
					[SITES]: { value: 3, source_id: srcId },
					[CRM]: { value: 'zoho', source_id: srcId },
					nobody_declared: { value: 1, source_id: srcId },
				}),
			})

			// WHEN a person applies it
			const { outcome, facts } = await applyRecorded(runId, proposalId)

			// THEN one landed, one was held, one was dropped, and the record says so
			expect(outcome.outcome).toBe('applied')
			expect(facts).toMatchObject({
				'research.apply.attributes_landed': 1,
				'research.apply.attributes_held': 1,
				'research.apply.attributes_dropped': 1,
				'research.apply.attributes_dropped_reasons': 'undeclared',
			})
		})

		it('should claim nothing when the row moved and the change was refused', async () => {
			// GIVEN a proposal made against version 0 of a row now at version 1
			const companyId = await seedCompany()
			await pool.query(`UPDATE companies SET version = 1 WHERE id = $1`, [
				companyId,
			])
			const { runId, proposalId } = await seedRun({
				companyId,
				attributes: srcId => ({ [SITES]: { value: 3, source_id: srcId } }),
			})

			// WHEN applied
			const { outcome, facts } = await applyRecorded(runId, proposalId)

			// THEN it is a conflict and the record counts no landed value
			expect(outcome.outcome).toBe('conflict')
			expect(facts['research.apply.attributes_landed']).toBeUndefined()
		})
	})

	describe('when the row moved under the proposal', () => {
		it('should write nothing, attributes included', async () => {
			// GIVEN a proposal made against version 0 of a row now at version 1
			const companyId = await seedCompany()
			await pool.query(`UPDATE companies SET version = 1 WHERE id = $1`, [
				companyId,
			])
			const { runId, proposalId } = await seedRun({
				companyId,
				attributes: srcId => ({ [SITES]: { value: 3, source_id: srcId } }),
			})

			// WHEN applied
			const outcome = await apply(runId, proposalId)

			// THEN it is a conflict and the column is untouched
			expect(outcome.outcome).toBe('conflict')
			expect((await readRow(companyId)).attributes).toEqual({})
		})
	})
})
