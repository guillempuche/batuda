// Live-DB integration test for the proposal packages/research adds when a run
// read attribute values for the company it was about but changed no CRM field
// — see packages/research/src/application/attribute-proposal.ts. Without that
// proposal, a run whose only news is the attributes it found leaves nothing
// for a person to apply, so the values it read never land. The proposal is
// seeded here exactly as that module builds it, `fields` as the empty object
// every stored proposal carries, and applied the way a person would.
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
import { resolveResearchProposedUpdate } from './research-apply'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const suffix = randomUUID().slice(0, 8)
const ORG = `apply-attr-prop-${suffix}`
const FAMILY_OWNED = `family_owned_${suffix}`
const PAGE = `https://acme.example/${suffix}/about`
const QUOTE = 'Una empresa familiar'

// The reason string packages/research/src/application/attribute-proposal.ts
// stamps on the proposal it adds — kept as a literal here, not imported, so
// this test still catches a change to that wording landing on a differently
// shaped proposal.
const ATTRIBUTE_PROPOSAL_REASON =
	'Attribute values read from the pages, for the company on file.'

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

// The same, with the request's record open, so a test can read what the apply
// wrote on it — how many attribute values landed, were held or were dropped.
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

// A succeeded run about `companyId`, whose findings carry the family_owned
// value packages/research read (quoting the page it cites) and one proposal
// naming the company, with the empty fields every stored proposal carries.
const seedRun = async (args: {
	readonly companyId: string
	readonly sourceId: string
	readonly fetchedByRun: boolean
}): Promise<{ runId: string; proposalId: string }> => {
	const proposalId = randomUUID()
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, findings, context)
		 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb, $3::jsonb) RETURNING id`,
		[
			ORG,
			JSON.stringify({
				attributes: {
					[FAMILY_OWNED]: {
						value: true,
						source_id: args.sourceId,
						quote: QUOTE,
						confidence: null,
					},
				},
				proposed_updates: [
					{
						id: proposalId,
						status: 'pending',
						subject_table: 'companies',
						operation: 'update',
						subject_id: args.companyId,
						expected_version: 0,
						fields: {},
						reason: ATTRIBUTE_PROPOSAL_REASON,
						citations: [],
					},
				],
			}),
			JSON.stringify({
				subjects: [{ table: 'companies', id: args.companyId }],
			}),
		],
	)
	const runId = r.rows[0]?.id as string
	if (args.fetchedByRun)
		await pool.query(
			`INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents)
			 VALUES ($1, $2, $3, $4, now(), 0)`,
			[ORG, runId, args.sourceId, PAGE],
		)
	return { runId, proposalId }
}

const seedSource = async (): Promise<string> => {
	const srcId = `src_${randomUUID().slice(0, 8)}`
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash)
		 VALUES ($1, 'web', 'test', $2, $3, 'acme.example', $4)`,
		[srcId, PAGE, `hash-${randomUUID()}`, `content-${randomUUID()}`],
	)
	return srcId
}

// A page the run never fetched — cited by id but with no
// research_run_sources row: reading a value off a page nobody actually opened.
const seedUnfetchedSourceId = (): string => `src_${randomUUID().slice(0, 8)}`

const readRow = async (id: string) => {
	const r = await pool.query<{
		attributes: Record<string, unknown>
		field_provenance: Record<string, unknown> | null
		version: number
		name: string
		industry: string | null
	}>(
		`SELECT attributes, field_provenance, version, name, industry FROM companies WHERE id = $1`,
		[id],
	)
	return r.rows[0] as NonNullable<(typeof r.rows)[0]>
}

// What list_research_proposed_updates reads: the run's own findings, not a
// derived table — checking the same field this MCP tool exposes proves a
// pending proposal is listable without re-implementing its handler.
const pendingProposalStatus = async (
	runId: string,
	proposalId: string,
): Promise<string | undefined> => {
	const r = await pool.query<{
		findings: { proposed_updates?: Array<Record<string, unknown>> }
	}>(`SELECT findings FROM research_runs WHERE id = $1`, [runId])
	const proposals = r.rows[0]?.findings.proposed_updates ?? []
	return proposals.find(p => p['id'] === proposalId)?.['status'] as
		| string
		| undefined
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
		`INSERT INTO research_attributes (organization_id, stack_id, key, label, kind, created_by)
		 VALUES ($1, $2, $3, 'Family owned', 'boolean', 'u1')`,
		[ORG, stackId, FAMILY_OWNED],
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

describe("a run's attribute values, applied through the proposal the run adds for them", () => {
	describe('when a run read attributes for company X and changed no field, and a person applies the proposal for it', () => {
		it('should land the attribute, stamped as the run’s, and touch nothing else on the row', async () => {
			// GIVEN the same run and proposal, but with fields as the object `{}`
			// research-apply.ts's validate() actually accepts — the shape
			// findings.proposed_updates already carries for every other proposal
			// in this codebase once written through JSON.stringify
			const companyId = await seedCompany()
			const sourceId = await seedSource()
			const { runId, proposalId } = await seedRun({
				companyId,
				sourceId,
				fetchedByRun: true,
			})

			// WHEN it is listed and a person applies it
			const listed = await pendingProposalStatus(runId, proposalId)
			const outcome = await apply(runId, proposalId)

			// THEN it was there to apply, the attribute landed with its quote and
			// a source pointing at the page, and nothing else on the row moved
			expect(listed).toBe('pending')
			expect(outcome.outcome).toBe('applied')
			const row = await readRow(companyId)
			expect(row.attributes).toEqual({
				[FAMILY_OWNED]: {
					value: true,
					source_url: PAGE,
					quote: QUOTE,
					research_id: runId,
					set_by: 'research',
				},
			})
			expect(row.field_provenance).toEqual({
				[`attributes.${FAMILY_OWNED}`]: { sourceUrl: PAGE, runId },
			})
			expect(row.name).toBe('Acme')
			expect(row.industry).toBeNull()
			expect(row.version).toBe(1)
		})
	})

	describe('when the value cites a page the run never fetched', () => {
		it('should drop the value as unfetched and report no_applicable_fields', async () => {
			// GIVEN a proposal whose only attribute cites a page with no
			// research_run_sources row for this run
			const companyId = await seedCompany()
			const sourceId = seedUnfetchedSourceId()
			const { runId, proposalId } = await seedRun({
				companyId,
				sourceId,
				fetchedByRun: false,
			})

			// WHEN applied
			const outcome = await apply(runId, proposalId)

			// THEN nothing else was proposed, so once the value is dropped there is
			// nothing left to apply, and the column is untouched
			expect(outcome.outcome).toBe('no_applicable_fields')
			expect((await readRow(companyId)).attributes).toEqual({})
		})
	})

	describe('when a person had already set the attribute by hand', () => {
		it("should hold the run's value back, keep the person's, and count it as held on the request's record", async () => {
			// GIVEN the company already carries a person's own value for the key
			// the run also read
			const companyId = await seedCompany({
				[FAMILY_OWNED]: { value: false, set_by: 'client' },
			})
			const sourceId = await seedSource()
			const { runId, proposalId } = await seedRun({
				companyId,
				sourceId,
				fetchedByRun: true,
			})

			// WHEN applied
			const { outcome, facts } = await applyRecorded(runId, proposalId)

			// THEN nothing else was proposed either, so once the run's value is
			// held back there is nothing left to apply, but the record still
			// counts the hold, and the person's value stands
			expect(outcome.outcome).toBe('no_applicable_fields')
			expect(facts['research.apply.attributes_held']).toBe(1)
			expect(facts['research.apply.attributes_landed']).toBe(0)
			const row = await readRow(companyId)
			expect(row.attributes).toEqual({
				[FAMILY_OWNED]: { value: false, set_by: 'client' },
			})
		})
	})
})
