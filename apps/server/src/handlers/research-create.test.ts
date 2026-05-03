// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the research_runs INSERTs that
// `packages/research/src/application/research-service.ts` runs from
// `svc.create()`. Replicates the two INSERT shapes (cache-hit clone +
// fresh run) using raw `pg` with `app.current_org_id` set on the
// session, so the org_isolation_research_paid_spend / research_runs
// RLS policies engage exactly as they do at runtime.
//
// The function-level wiring (handler `yield* CurrentOrg` → svc.create
// gets organizationId → INSERT includes the column) is verified by
// running the dev stack and submitting Run-new-research from the UI;
// see plan's Verification section.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('research_runs INSERT — RLS contract', () => {
	let pool: pg.Pool
	let orgId: string
	let userId: string
	const seededIds: string[] = []

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
		await pool.query('GRANT app_user TO CURRENT_USER')

		const orgs = await pool.query<{ id: string }>(
			`SELECT id FROM organization WHERE slug = $1 LIMIT 1`,
			['taller'],
		)
		const oid = orgs.rows[0]?.id
		if (!oid) {
			throw new Error("taller org missing — run 'pnpm cli db reset' first")
		}
		orgId = oid

		const users = await pool.query<{ id: string }>(
			`SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
			['admin@taller.cat'],
		)
		const uid = users.rows[0]?.id
		if (!uid) {
			throw new Error(
				"admin@taller.cat missing — run 'pnpm cli db reset' first",
			)
		}
		userId = uid
	})

	afterAll(async () => {
		for (const id of seededIds) {
			await pool.query(`DELETE FROM research_runs WHERE id = $1::uuid`, [id])
		}
		await pool.end()
	})

	const withOrgScope = async <T>(
		body: (client: pg.PoolClient) => Promise<T>,
	): Promise<T> => {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			await client.query('SET LOCAL ROLE app_user')
			await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
				orgId,
			])
			const result = await body(client)
			await client.query('COMMIT')
			return result
		} catch (err) {
			await client.query('ROLLBACK')
			throw err
		} finally {
			client.release()
		}
	}

	describe('when the fresh-run INSERT includes organization_id', () => {
		it('should pass the org_isolation_research_runs WITH CHECK clause as app_user', async () => {
			// GIVEN app.current_org_id = taller.id and SET ROLE app_user
			// WHEN INSERT INTO research_runs runs with organization_id=taller.id
			//      (mirrors research-service.ts:777-794 fresh-run shape)
			// THEN the policy approves the row
			// [research-service.ts:777-794 — fresh-run INSERT]
			const id = randomUUID()
			seededIds.push(id)

			const inserted = await withOrgScope(async client => {
				const result = await client.query<{
					id: string
					organization_id: string
				}>(
					`INSERT INTO research_runs (
						id,
						organization_id,
						query, mode, schema_name, status, context,
						budget_cents, paid_budget_cents,
						paid_policy, idempotency_key, created_by
					) VALUES (
						$1::uuid,
						$2,
						$3, 'deep', 'freeform', 'queued', '{}'::jsonb,
						100, 500,
						'{}'::jsonb, NULL, $4
					)
					RETURNING id, organization_id`,
					[id, orgId, `Test query ${id}`, userId],
				)
				return result.rows[0]
			})

			expect(inserted?.id).toBe(id)
			expect(inserted?.organization_id).toBe(orgId)
		})
	})

	describe('when the cache-hit clone INSERT includes organization_id', () => {
		it('should pass the WITH CHECK clause for the cache_hit kind', async () => {
			// GIVEN app.current_org_id = taller.id
			// WHEN INSERT INTO research_runs runs with kind='cache_hit' + organization_id
			//      (mirrors research-service.ts:704-728 clone shape)
			// THEN the policy approves the row
			// [research-service.ts:704-728 — cache-hit clone INSERT]
			const id = randomUUID()
			seededIds.push(id)

			const inserted = await withOrgScope(async client => {
				const result = await client.query<{
					id: string
					organization_id: string
					kind: string
				}>(
					`INSERT INTO research_runs (
						id,
						organization_id,
						query, mode, schema_name, kind, status, context,
						findings, brief_md,
						tokens_in, tokens_out,
						cost_cents, paid_cost_cents,
						idempotency_key, created_by,
						started_at, completed_at
					) VALUES (
						$1::uuid,
						$2,
						$3, 'deep', 'freeform', 'cache_hit', 'succeeded', '{}'::jsonb,
						'{}'::jsonb, NULL,
						0, 0,
						0, 0,
						NULL, $4,
						now(), now()
					)
					RETURNING id, organization_id, kind`,
					[id, orgId, `Cached query ${id}`, userId],
				)
				return result.rows[0]
			})

			expect(inserted?.id).toBe(id)
			expect(inserted?.organization_id).toBe(orgId)
			expect(inserted?.kind).toBe('cache_hit')
		})
	})

	describe('when the INSERT omits organization_id (the pre-fix shape)', () => {
		it('should fail because the column is NOT NULL', async () => {
			// GIVEN the pre-fix INSERT — no organization_id column in the list
			// WHEN it runs as app_user with app.current_org_id set
			// THEN the INSERT fails because organization_id is NOT NULL with no default
			//      (this is the bug the slice fixes — proves the fix is load-bearing)
			// [research-service.ts (pre-slice) — missing organization_id]
			const id = randomUUID()

			await expect(
				withOrgScope(async client => {
					await client.query(
						`INSERT INTO research_runs (
							id,
							query, mode, schema_name, status, context,
							budget_cents, paid_budget_cents,
							paid_policy, idempotency_key, created_by
						) VALUES (
							$1::uuid,
							$2, 'deep', 'freeform', 'queued', '{}'::jsonb,
							100, 500,
							'{}'::jsonb, NULL, $3
						)`,
						[id, `Bug repro ${id}`, userId],
					)
				}),
			).rejects.toThrow(
				/null value in column "organization_id"|row.level security/i,
			)
		})
	})
})
