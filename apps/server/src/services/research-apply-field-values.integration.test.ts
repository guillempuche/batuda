// Live-DB integration test for refusing a research-proposed value that the
// target column does not accept. The columns with a fixed vocabulary are backed
// by CHECK constraints, so a value the model invented would otherwise reach the
// database and come back as a failed request; these assert it is turned away as
// a bad proposal first, and that nothing on the row moves when it is.
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
const ORG = `field-values-org-${randomUUID()}`

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
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, 'Acme', 'prospect') RETURNING id`,
		[ORG, `acme-${randomUUID()}`],
	)
	return r.rows[0]!.id
}

const seedRun = async (
	companyId: string,
	fields: Record<string, unknown>,
): Promise<{ runId: string; proposalId: string }> => {
	const proposalId = randomUUID()
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs
			(organization_id, query, status, created_by, findings)
		 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb) RETURNING id`,
		[
			ORG,
			JSON.stringify({
				proposed_updates: [
					{
						id: proposalId,
						status: 'pending',
						subject_table: 'companies',
						operation: 'update',
						subject_id: companyId,
						expected_version: 0,
						fields,
						citations: [],
					},
				],
			}),
		],
	)
	return { runId: r.rows[0]!.id, proposalId }
}

const companyRow = async (id: string) => {
	const r = await pool.query<{
		status: string
		industry: string | null
	}>(`SELECT status, industry FROM companies WHERE id = $1`, [id])
	return r.rows[0]
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

describe('resolveResearchProposedUpdate field values', () => {
	describe('when a proposal carries a status outside the vocabulary', () => {
		it('should refuse it as a bad proposal rather than failing the request', async () => {
			// GIVEN a run proposing a stage from a vocabulary the app no longer has,
			// alongside a field that on its own would apply cleanly
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun(companyId, {
				status: 'qualified',
				industry: 'transport',
			})

			// WHEN it is applied
			const outcome = await apply(runId, proposalId)

			// THEN it comes back as an unusable proposal, naming what was wrong
			expect(outcome.outcome).toBe('invalid')
			if (outcome.outcome !== 'invalid') return
			expect(outcome.reason).toContain('status')
		})
	})

	describe('when a proposal is refused for one bad value', () => {
		it('should leave every other proposed field unwritten', async () => {
			// GIVEN the same mix of one unusable value and one good one
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun(companyId, {
				status: 'qualified',
				industry: 'transport',
			})

			// WHEN it is applied
			const outcome = await apply(runId, proposalId)

			// THEN the row is untouched for the stated reason — any other refusal
			// would leave it untouched too, so the reason is what pins this
			expect(outcome.outcome).toBe('invalid')
			const row = await companyRow(companyId)
			expect(row?.status).toBe('prospect')
			expect(row?.industry).toBeNull()
		})
	})

	describe('when every proposed value is one the column accepts', () => {
		it('should apply it as before', async () => {
			// GIVEN a proposal whose stage is in the current vocabulary
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRun(companyId, {
				status: 'contacted',
				industry: 'transport',
			})

			// WHEN it is applied
			const outcome = await apply(runId, proposalId)

			// THEN both fields land
			expect(outcome.outcome).toBe('applied')
			const row = await companyRow(companyId)
			expect(row?.status).toBe('contacted')
			expect(row?.industry).toBe('transport')
		})
	})
})

// The other half of the rule the unattended path enforces: when a person IS the
// one applying, the run's written brief is meant to land. Nothing else covers
// this — the enrichment suite drives the write directly and so never exercises
// the step that decides, from who asked, whether the run's words may be written.
describe("resolveResearchProposedUpdate, on the run's written brief", () => {
	describe('when a person applies a change to the company the run was about', () => {
		it("should write the run's brief onto that company", async () => {
			// GIVEN a company the run was pinned to, and a run that wrote a brief
			const companyId = await seedCompany()
			const proposalId = randomUUID()
			const run = await pool.query<{ id: string }>(
				`INSERT INTO research_runs
					(organization_id, query, status, created_by, findings, brief_md, context)
				 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb, $3, $4::jsonb) RETURNING id`,
				[
					ORG,
					JSON.stringify({
						proposed_updates: [
							{
								id: proposalId,
								status: 'pending',
								subject_table: 'companies',
								operation: 'update',
								subject_id: companyId,
								expected_version: 0,
								fields: { industry: 'logistics' },
								citations: [],
							},
						],
					}),
					'## Acme — 2026-08-25\n\nA carrier.',
					JSON.stringify({
						subjects: [{ table: 'companies', id: companyId }],
					}),
				],
			)

			// WHEN a person applies it
			await apply(run.rows[0]!.id, proposalId)

			// THEN the brief is on the company, because somebody chose to put it there
			const r = await pool.query<{ account_brief: string | null }>(
				`SELECT account_brief FROM companies WHERE id = $1`,
				[companyId],
			)
			expect(r.rows[0]?.account_brief).toBe(
				'## Acme — 2026-08-25\n\nA carrier.',
			)
		})
	})
})

// A proposal is written by a model. The two doors a person or an assistant come
// through decode a schema first, so a value that could never be what it claims to
// be never reaches a row from there. Applying was a third door and checked almost
// nothing: an empty company name, a map link that was not one, and addresses
// nobody could ever write to all landed, and the apply reported success.
describe('resolveResearchProposedUpdate, on values that could never be right', () => {
	const seedRunWith = async (
		companyId: string,
		fields: Record<string, unknown>,
	) => {
		const proposalId = randomUUID()
		const r = await pool.query<{ id: string }>(
			`INSERT INTO research_runs
				(organization_id, query, status, created_by, findings)
			 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb) RETURNING id`,
			[
				ORG,
				JSON.stringify({
					proposed_updates: [
						{
							id: proposalId,
							status: 'pending',
							subject_table: 'companies',
							operation: 'update',
							subject_id: companyId,
							expected_version: 0,
							fields,
							citations: [],
						},
					],
				}),
			],
		)
		return { runId: r.rows[0]!.id, proposalId }
	}

	const addressesOn = async (subjectId: string) => {
		const r = await pool.query<{ channel: string; address: string }>(
			`SELECT channel, address FROM channels WHERE subject_id = $1 ORDER BY channel`,
			[subjectId],
		)
		return r.rows
	}

	describe('when a run proposes an address nobody could ever write to', () => {
		it('should leave it out and still write the rest', async () => {
			// GIVEN a run offering three addresses, none of them possible
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRunWith(companyId, {
				industry: 'logistics',
				email: 'not-an-email',
				phone: 'banana',
				website: 'nope',
			})

			// WHEN a person applies it
			await apply(runId, proposalId)

			// THEN none of them reached the company
			expect(await addressesOn(companyId)).toEqual([])
			// AND what was fine still landed, so one bad address did not cost the
			// run everything else it found
			expect((await companyRow(companyId))?.industry).toBe('logistics')
		})
	})

	describe('when a run proposes addresses that are possible', () => {
		it('should write them', async () => {
			// GIVEN a run offering two well-formed addresses
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRunWith(companyId, {
				email: 'hola@acme.es',
				website: 'https://acme.es',
			})

			// WHEN a person applies it
			await apply(runId, proposalId)

			// THEN both are on the company
			expect(await addressesOn(companyId)).toEqual([
				{ channel: 'email', address: 'hola@acme.es' },
				{ channel: 'website', address: 'https://acme.es' },
			])
		})
	})

	describe('when a run proposes a company with no name', () => {
		it('should refuse the change rather than blank the name', async () => {
			// GIVEN a run proposing to empty the company's name
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRunWith(companyId, {
				name: '   ',
			})

			// WHEN a person applies it
			const outcome = await apply(runId, proposalId)

			// THEN it is refused, and said why
			expect(outcome).toMatchObject({ outcome: 'invalid' })
			expect((outcome as { reason: string }).reason).toContain('name')
		})
	})

	describe('when a run proposes a map link that is not one', () => {
		it('should refuse the change', async () => {
			// GIVEN a run offering prose where a map link belongs
			const companyId = await seedCompany()
			const { runId, proposalId } = await seedRunWith(companyId, {
				googleMapsUrl: 'definitely not a url',
			})

			// WHEN a person applies it
			const outcome = await apply(runId, proposalId)

			// THEN it is refused, and said why
			expect(outcome).toMatchObject({ outcome: 'invalid' })
			expect((outcome as { reason: string }).reason).toContain('googleMapsUrl')
		})
	})

	// A discovered person arrives by a different road than a company's own
	// addresses — a list on the proposal rather than named fields — so the two
	// need holding to the rule separately.
	describe('when a run discovers a person reachable at an impossible address', () => {
		it('should keep the person and leave the address out', async () => {
			// GIVEN a run proposing somebody real with one made-up mailbox, one
			// number that is not a number, and one page that is fine
			const companyId = await seedCompany()
			const proposalId = randomUUID()
			const run = await pool.query<{ id: string }>(
				`INSERT INTO research_runs (organization_id, query, status, created_by, findings)
				 VALUES ($1, 'q', 'succeeded', 'u1', $2::jsonb) RETURNING id`,
				[
					ORG,
					JSON.stringify({
						proposed_updates: [
							{
								id: proposalId,
								status: 'pending',
								operation: 'create',
								subject_table: 'contacts',
								citations: [],
								fields: {
									name: 'Mar Soler',
									company_id: companyId,
									channels: [
										{ kind: 'email', value: 'not-an-email' },
										{ kind: 'phone', value: 'banana' },
										{ kind: 'linkedin', value: 'https://linkedin.com/in/mar' },
									],
								},
							},
						],
					}),
				],
			)

			// WHEN a person applies it
			await apply(run.rows[0]!.id, proposalId)

			// THEN the person is on file
			const people = await pool.query<{ id: string }>(
				`SELECT id FROM contacts WHERE company_id = $1 AND name = 'Mar Soler'`,
				[companyId],
			)
			expect(people.rows).toHaveLength(1)

			// AND only the address that could be one was kept
			expect(await addressesOn(people.rows[0]!.id)).toEqual([
				{ channel: 'linkedin', address: 'https://linkedin.com/in/mar' },
			])
		})
	})
})
