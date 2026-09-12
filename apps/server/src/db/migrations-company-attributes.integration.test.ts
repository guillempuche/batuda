// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { enterOrgScope } from '../middleware/org'
import { PgLive } from './client.js'
import addAttributes from './migrations/0069_company_attributes'

// The one destructive-looking step of the attributes migration: the value a
// company held in its old `current_tools` column is copied into the merged
// `attributes` column, and each organisation that received a copy gets the
// key declared on its default research stack so the copies stay editable.
// The copy and the declaration are what a re-run has to leave alone, and
// neither can be shown without a real database.

const DATABASE_URL = process.env['DATABASE_URL'] as string

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<A>,
	)

let pool: pg.Pool
const orgs: Array<string> = []

const newOrg = () => {
	const id = `attr-mig-${randomUUID()}`
	orgs.push(id)
	return id
}

const seedStack = async (
	orgId: string,
	agent: string,
	ownerUserId: string | null,
	isDefault: boolean,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO instruction_stacks (organization_id, owner_user_id, agent, name, is_default)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		[orgId, ownerUserId, agent, `st-${randomUUID()}`, isDefault],
	)
	return r.rows[0]?.id as string
}

// Written straight in, past the schemas: the old column and the shapes the
// migration has to meet.
const seedCompany = async (
	orgId: string,
	currentTools: string | null,
	attributes: Record<string, unknown> = {},
	deleted = false,
	provenance: Record<string, unknown> | null = null,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, current_tools, attributes, deleted_at, field_provenance)
		 VALUES ($1, $2, 'Seeded', $3, $4::jsonb, $5, $6::jsonb)
		 RETURNING id`,
		[
			orgId,
			`co-${randomUUID()}`,
			currentTools,
			JSON.stringify(attributes),
			deleted ? new Date() : null,
			provenance === null ? null : JSON.stringify(provenance),
		],
	)
	return r.rows[0]?.id as string
}

const readProvenance = async (
	id: string,
): Promise<Record<string, unknown> | null> => {
	const r = await pool.query<{
		field_provenance: Record<string, unknown> | null
	}>(`SELECT field_provenance FROM companies WHERE id = $1`, [id])
	return r.rows[0]?.field_provenance ?? null
}

const readAttributes = async (id: string): Promise<Record<string, unknown>> => {
	const r = await pool.query<{ attributes: Record<string, unknown> }>(
		`SELECT attributes FROM companies WHERE id = $1`,
		[id],
	)
	return r.rows[0]?.attributes ?? {}
}

const declarations = async (orgId: string) =>
	(
		await pool.query<{
			stack_id: string
			key: string
			label: string
			kind: string
			is_active: boolean
			created_by: string
		}>(
			`SELECT stack_id, key, label, kind, is_active, created_by
			 FROM research_attributes WHERE organization_id = $1 ORDER BY key`,
			[orgId],
		)
	).rows

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// Lets this session take the app role, so the isolation case can read as a
	// member of one organisation would.
	await pool.query('GRANT app_user TO CURRENT_USER')
})

afterAll(async () => {
	for (const org of orgs) {
		await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [org])
		await pool.query(
			`DELETE FROM instruction_stacks WHERE organization_id = $1`,
			[org],
		)
	}
	await pool.end()
})

describe('migration 0069: copying current tools into attributes', () => {
	describe('when a company holds a value in the old column', () => {
		it('should copy it trimmed under the current_tools key, as set by a person, and leave the column', async () => {
			// GIVEN a company with a padded value in the old column
			const org = newOrg()
			await seedStack(org, 'research', null, true)
			const id = await seedCompany(org, '  Odoo, Excel  ')

			// WHEN the migration runs
			await run(addAttributes)

			// THEN the value sits under the key, trimmed, stamped as a person's,
			// AND the old column is untouched for one more release
			expect(await readAttributes(id)).toEqual({
				current_tools: { value: 'Odoo, Excel', set_by: 'client' },
			})
			const r = await pool.query<{ current_tools: string }>(
				`SELECT current_tools FROM companies WHERE id = $1`,
				[id],
			)
			expect(r.rows[0]?.current_tools).toBe('  Odoo, Excel  ')
		})

		it("should keep a value a run wrote as the run's, and move its trail under the new key", async () => {
			// GIVEN a value the apply path once landed from a run, with its note
			const org = newOrg()
			const runId = randomUUID()
			const note = {
				sourceUrl: 'https://acme.example/tools',
				runId,
				asOf: '2026-01-02',
			}
			const id = await seedCompany(org, 'Odoo', {}, false, {
				currentTools: note,
				website: { sourceUrl: 'https://acme.example', runId },
			})

			// WHEN the migration runs
			await run(addAttributes)

			// THEN the value stays research's, carrying the page, the run and the
			// date, and the note now sits under the attribute key beside the rest
			expect(await readAttributes(id)).toEqual({
				current_tools: {
					value: 'Odoo',
					set_by: 'research',
					research_id: runId,
					source_url: 'https://acme.example/tools',
					as_of: '2026-01-02',
				},
			})
			expect(await readProvenance(id)).toEqual({
				'attributes.current_tools': note,
				website: { sourceUrl: 'https://acme.example', runId },
			})
		})

		it('should leave a stale note alone when the column it describes is blank', async () => {
			// GIVEN a run's note for a value a person has since blanked
			const org = newOrg()
			const note = {
				sourceUrl: 'https://acme.example/tools',
				runId: randomUUID(),
			}
			const id = await seedCompany(org, '', {}, false, { currentTools: note })

			// WHEN the migration runs
			await run(addAttributes)

			// THEN nothing is copied and the note is not moved to a key that holds no value
			expect(await readAttributes(id)).toEqual({})
			expect(await readProvenance(id)).toEqual({ currentTools: note })
		})

		it('should copy the value of a company taken out of view too', async () => {
			// GIVEN a deleted company with a value
			const org = newOrg()
			const id = await seedCompany(org, 'Sage', {}, true)

			// WHEN the migration runs
			await run(addAttributes)

			// THEN a restore would find the value where the live ones keep it
			expect(await readAttributes(id)).toEqual({
				current_tools: { value: 'Sage', set_by: 'client' },
			})
		})
	})

	describe('when the old column holds nothing worth copying', () => {
		it('should leave a blank and a NULL alone', async () => {
			// GIVEN whitespace only, and nothing
			const org = newOrg()
			const blank = await seedCompany(org, '   ')
			const nothing = await seedCompany(org, null)

			// WHEN the migration runs
			await run(addAttributes)

			// THEN neither company gains a key
			expect(await readAttributes(blank)).toEqual({})
			expect(await readAttributes(nothing)).toEqual({})
		})
	})

	describe('when the company already carries the key', () => {
		it('should keep what is there rather than overwrite it', async () => {
			// GIVEN a value already under the key, set by a run
			const org = newOrg()
			const held = { current_tools: { value: 'Holded', set_by: 'research' } }
			const id = await seedCompany(org, 'Odoo', held)

			// WHEN the migration runs
			await run(addAttributes)

			// THEN the run's value stays
			expect(await readAttributes(id)).toEqual(held)
		})
	})
})

describe('migration 0069: declaring the copied key', () => {
	describe('when the organisation has an org default research stack and copied values', () => {
		it('should declare current_tools on that stack, active, as text', async () => {
			// GIVEN a default research stack, a personal default and an email default beside it
			const org = newOrg()
			const stack = await seedStack(org, 'research', null, true)
			await seedStack(org, 'research', 'u1', true)
			await seedStack(org, 'email', null, true)
			await seedCompany(org, 'Odoo')

			// WHEN the migration runs
			await run(addAttributes)

			// THEN exactly one declaration exists, on the org research default
			expect(await declarations(org)).toEqual([
				{
					stack_id: stack,
					key: 'current_tools',
					label: 'Current tools',
					kind: 'text',
					is_active: true,
					created_by: 'migration-0069',
				},
			])
		})
	})

	describe('when the organisation has values but no stack to declare them on', () => {
		it('should declare nothing and finish', async () => {
			// GIVEN only a personal default and an email default
			const org = newOrg()
			await seedStack(org, 'research', 'u1', true)
			await seedStack(org, 'email', null, true)
			await seedCompany(org, 'Odoo')

			// WHEN the migration runs
			await run(addAttributes)

			// THEN nothing is declared and nothing failed
			expect(await declarations(org)).toEqual([])
		})
	})

	describe('when the organisation has a stack but no values', () => {
		it('should declare nothing', async () => {
			// GIVEN a default research stack and companies with nothing to copy
			const org = newOrg()
			await seedStack(org, 'research', null, true)
			await seedCompany(org, null)
			await seedCompany(org, '  ')

			// WHEN the migration runs
			await run(addAttributes)

			// THEN no declaration
			expect(await declarations(org)).toEqual([])
		})
	})
})

describe('migration 0069: running twice', () => {
	describe('when it runs a second time over the same rows', () => {
		it('should change nothing it changed the first time', async () => {
			// GIVEN fixtures covering the copy, the untouched row and the declaration
			const org = newOrg()
			await seedStack(org, 'research', null, true)
			const copied = await seedCompany(org, 'Odoo')
			const kept = await seedCompany(org, 'Sage', {
				current_tools: { value: 'Holded', set_by: 'research' },
			})
			const byRun = await seedCompany(org, 'Sage', {}, false, {
				currentTools: {
					sourceUrl: 'https://acme.example/tools',
					runId: randomUUID(),
				},
			})
			await run(addAttributes)
			const once = [
				await readAttributes(copied),
				await readAttributes(kept),
				await readAttributes(byRun),
				await readProvenance(byRun),
				await declarations(org),
			]

			// WHEN it runs again
			await run(addAttributes)

			// THEN every value, every note and the one declaration are exactly as
			// after the first run
			const twice = [
				await readAttributes(copied),
				await readAttributes(kept),
				await readAttributes(byRun),
				await readProvenance(byRun),
				await declarations(org),
			]
			expect(twice).toEqual(once)
			expect((await declarations(org)).length).toBe(1)
		})
	})
})

describe('migration 0069: the table it creates', () => {
	describe('when two writers declare the same key on one stack', () => {
		it('should refuse the second row', async () => {
			// GIVEN a declaration
			const org = newOrg()
			const stack = await seedStack(org, 'research', null, true)
			const insert = () =>
				pool.query(
					`INSERT INTO research_attributes (organization_id, stack_id, key, label, kind, created_by)
					 VALUES ($1, $2, 'sites', 'Sites', 'number', 'u1')`,
					[org, stack],
				)
			await insert()

			// WHEN the same key is declared again on the same stack
			// THEN the unique index refuses it
			await expect(insert()).rejects.toMatchObject({ code: '23505' })
		})
	})

	describe('when a member of another organisation reads the table', () => {
		it('should see no row of the first organisation', async () => {
			// GIVEN a declaration of one organisation
			const org = newOrg()
			const other = newOrg()
			const stack = await seedStack(org, 'research', null, true)
			await pool.query(
				`INSERT INTO research_attributes (organization_id, stack_id, key, label, kind, created_by)
				 VALUES ($1, $2, 'sites', 'Sites', 'number', 'u1')`,
				[org, stack],
			)

			// WHEN the table is read inside the other organisation's scope
			const seen = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, {
						org: { id: other, name: 'o', slug: other },
					})(
						sql<{
							key: string
						}>`SELECT key FROM research_attributes WHERE organization_id = ${org}`,
					)
				}),
			)

			// THEN the policy hides it
			expect(seen).toEqual([])
		})
	})

	describe('when rows written before the migration meet the new columns', () => {
		it('should give a stack, a company and a run the safe defaults', async () => {
			// GIVEN a stack, a company and a run with none of the new columns named
			const org = newOrg()
			const stack = await seedStack(org, 'research', null, false)
			const company = await seedCompany(org, null)
			const runRow = await pool.query<{ id: string }>(
				`INSERT INTO research_runs (organization_id, query, status, created_by)
				 VALUES ($1, 'q', 'succeeded', 'u1') RETURNING id`,
				[org],
			)

			// THEN the switch is off, the values empty and the run carries no declarations
			const s = await pool.query<{ research_fills_attributes: boolean }>(
				`SELECT research_fills_attributes FROM instruction_stacks WHERE id = $1`,
				[stack],
			)
			expect(s.rows[0]?.research_fills_attributes).toBe(false)
			expect(await readAttributes(company)).toEqual({})
			const r = await pool.query<{
				attribute_fingerprint: string | null
				attribute_declarations: unknown
			}>(
				`SELECT attribute_fingerprint, attribute_declarations FROM research_runs WHERE id = $1`,
				[runRow.rows[0]?.id],
			)
			expect(r.rows[0]).toEqual({
				attribute_fingerprint: null,
				attribute_declarations: [],
			})
			await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
				org,
			])
		})
	})
})
