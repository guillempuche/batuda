// Live-DB integration test for the RLS the instruction-template management API
// relies on (migration 0008). Verifies that, as the app_user role:
//   - a member sees org-owned templates + their own, never another member's
//     personal ones, and never another org's rows;
//   - an in-use template can't be deleted (FK RESTRICT — the deletion guard);
//   - an unset GUC fails closed.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on $DATABASE_URL, and
// `pnpm cli db reset && pnpm cli db migrate` so the 0008 policies apply.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

// Random per run so re-running locally without a reset doesn't collide.
const ORG_A = `instr-orgA-${randomUUID()}`
const ORG_B = `instr-orgB-${randomUUID()}`
const U1 = `instr-u1-${randomUUID()}`
const U2 = `instr-u2-${randomUUID()}`

let pool: pg.Pool
let orgATemplate: string
let u1Personal: string
let orgBTemplate: string

// Run a query block as the request-scoped role with both GUCs set, exactly like
// OrgMiddleware's `enterOrgScope`. ROLLBACK so the suite leaves no trace.
const asAppUser = async <T>(
	orgId: string,
	userId: string,
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		await client.query('SET LOCAL ROLE app_user')
		await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
			orgId,
		])
		await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
			userId,
		])
		const result = await fn(client)
		await client.query('ROLLBACK')
		return result
	} finally {
		client.release()
	}
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// Seed as the DATABASE_URL owner (BYPASSRLS / superuser), so FORCE RLS
	// doesn't gate the fixtures.
	const t = await pool.query<{ id: string }>(
		`INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
		 VALUES ($1, NULL, 'Org A template', 'org body', $2) RETURNING id`,
		[ORG_A, U1],
	)
	orgATemplate = t.rows[0]?.id ?? ''
	const p = await pool.query<{ id: string }>(
		`INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
		 VALUES ($1, $2, 'U1 personal', 'mine', $2) RETURNING id`,
		[ORG_A, U1],
	)
	u1Personal = p.rows[0]?.id ?? ''
	const tb = await pool.query<{ id: string }>(
		`INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
		 VALUES ($1, NULL, 'Org B template', 'b body', $2) RETURNING id`,
		[ORG_B, U2],
	)
	orgBTemplate = tb.rows[0]?.id ?? ''
	// An org default stack referencing the org-A template, so it is "in use".
	const s = await pool.query<{ id: string }>(
		`INSERT INTO instruction_stacks (organization_id, owner_user_id, agent, name, is_default)
		 VALUES ($1, NULL, 'research', 'default', true) RETURNING id`,
		[ORG_A],
	)
	await pool.query(
		`INSERT INTO instruction_stack_items (organization_id, stack_id, template_id, position)
		 VALUES ($1, $2, $3, 0)`,
		[ORG_A, s.rows[0]?.id, orgATemplate],
	)
})

afterAll(async () => {
	// Stacks first (cascades items, which RESTRICT-reference templates).
	await pool.query(
		`DELETE FROM instruction_stacks WHERE organization_id = ANY($1::text[])`,
		[[ORG_A, ORG_B]],
	)
	await pool.query(
		`DELETE FROM instruction_templates WHERE organization_id = ANY($1::text[])`,
		[[ORG_A, ORG_B]],
	)
	await pool.end()
})

describe('RLS: instruction_templates', () => {
	describe('when a member reads templates', () => {
		it("should see org-owned templates but not another member's personal one", () =>
			asAppUser(ORG_A, U2, async client => {
				// GIVEN an org template and U1's personal template in org A
				// WHEN U2 selects under their GUCs
				const rows = await client.query<{ id: string }>(
					'SELECT id FROM instruction_templates',
				)
				const ids = rows.rows.map(r => r.id)

				// THEN U2 sees the org-owned template
				expect(ids).toContain(orgATemplate)
				// AND never U1's personal template
				expect(ids).not.toContain(u1Personal)
				// [0008_instruction_templates.ts — read_instruction_templates USING]
			}))

		it('should never see another organization’s templates', () =>
			asAppUser(ORG_A, U1, async client => {
				// GIVEN an org-B template
				// WHEN U1 (org A) selects
				const rows = await client.query<{ id: string }>(
					'SELECT id FROM instruction_templates',
				)
				// THEN org B's row is invisible
				expect(rows.rows.map(r => r.id)).not.toContain(orgBTemplate)
			}))
	})

	describe('when a member writes a template into another org', () => {
		it('should be rejected by the WITH CHECK predicate', () =>
			asAppUser(ORG_A, U1, async client => {
				// GIVEN U1 is scoped to org A
				// WHEN they try to insert a row tagged org B
				const insert = client.query(
					`INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
					 VALUES ($1, $2, 'sneaky', 'x', $2)`,
					[ORG_B, U1],
				)
				// THEN RLS rejects the cross-org write
				await expect(insert).rejects.toThrow(/row-level security/i)
			}))
	})

	describe('when an in-use template is deleted', () => {
		it('should be blocked by the ON DELETE RESTRICT foreign key', () =>
			asAppUser(ORG_A, U1, async client => {
				// GIVEN the org-A template is referenced by a default stack item
				// WHEN U1 deletes it (RLS lets them target an org-owned row)
				const del = client.query(
					'DELETE FROM instruction_templates WHERE id = $1',
					[orgATemplate],
				)
				// THEN the FK RESTRICT blocks the delete
				await expect(del).rejects.toThrow(/foreign key|violates/i)
				// [0008_instruction_templates.ts — template_id ... ON DELETE RESTRICT]
			}))
	})

	describe('when the org GUC is unset', () => {
		it('should fail closed and return zero templates', async () => {
			const client = await pool.connect()
			try {
				await client.query('BEGIN')
				await client.query('SET LOCAL ROLE app_user')
				// GIVEN role=app_user with no org GUC set
				const rows = await client.query('SELECT 1 FROM instruction_templates')
				// THEN nothing is visible (current_setting NULL → predicate false)
				expect(rows.rows).toHaveLength(0)
			} finally {
				await client.query('ROLLBACK')
				client.release()
			}
		})
	})
})
