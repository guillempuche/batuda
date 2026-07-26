// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the pair of writes that
// `apps/server/src/handlers/documents.ts` and
// `apps/server/src/mcp/tools/documents.ts` both run when a document is
// created: the row itself, then the link saying which record it is filed
// under. Uses raw `pg` with `app.current_org_id` set on the session, so the
// org_isolation_documents and org_isolation_document_links policies engage
// exactly as they do at runtime.
//
// Two failure shapes are pinned alongside the passing one, because both are
// silent if the guard ever goes: an INSERT that forgets organization_id, and
// a link that claims to belong to another organisation.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('documents create — RLS contract', () => {
	let pool: pg.Pool
	let orgId: string
	const seededDocumentIds: string[] = []
	const seededCompanyIds: string[] = []

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
		await pool.query('GRANT app_user TO CURRENT_USER')

		const orgs = await pool.query<{ id: string }>(
			`SELECT id FROM organization WHERE slug = $1 LIMIT 1`,
			['taller'],
		)
		const oid = orgs.rows[0]?.id
		if (!oid) {
			throw new Error(
				"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
			)
		}
		orgId = oid
	})

	afterAll(async () => {
		for (const id of seededDocumentIds) {
			// The link goes with the document through its foreign key.
			await pool.query(`DELETE FROM documents WHERE id = $1::uuid`, [id])
		}
		for (const id of seededCompanyIds) {
			await pool.query(`DELETE FROM companies WHERE id = $1::uuid`, [id])
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

	const seedCompany = async (client: pg.PoolClient): Promise<string> => {
		const id = randomUUID()
		const slug = `documents-test-${id}`
		await client.query(
			`INSERT INTO companies (id, organization_id, slug, name)
			 VALUES ($1::uuid, $2, $3, 'Documents Test Co')`,
			[id, orgId, slug],
		)
		seededCompanyIds.push(id)
		return id
	}

	describe('when a document and its first filing are written together', () => {
		it('should store both and report where the document is filed', async () => {
			// GIVEN app.current_org_id = taller.id and SET ROLE app_user
			// WHEN the create path inserts the document then its link
			// THEN both policies approve, and the document is reachable through
			//      the record it was filed under — which is the only way a
			//      document is found now that it carries no company column
			const id = randomUUID()
			seededDocumentIds.push(id)

			const filed = await withOrgScope(async client => {
				const companyId = await seedCompany(client)
				await client.query(
					`INSERT INTO documents (id, organization_id, type, content)
					 VALUES ($1::uuid, $2, 'general', 'Test content')`,
					[id, orgId],
				)
				await client.query(
					`INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
					 VALUES ($1, $2::uuid, 'companies', $3::uuid)`,
					[orgId, id, companyId],
				)
				const result = await client.query<{
					id: string
					type: string
					subject_table: string
					subject_id: string
				}>(
					`SELECT d.id, d.type, dl.subject_table, dl.subject_id
					 FROM documents d
					 JOIN document_links dl ON dl.document_id = d.id
					 WHERE d.id = $1::uuid`,
					[id],
				)
				return { row: result.rows[0], companyId }
			})

			expect(filed.row?.id).toBe(id)
			expect(filed.row?.type).toBe('general')
			expect(filed.row?.subject_table).toBe('companies')
			expect(filed.row?.subject_id).toBe(filed.companyId)
		})

		it('should refuse a second filing of the same pair without failing', async () => {
			// GIVEN a document already filed against a company
			// WHEN the same pair is written again, as re-filing does
			// THEN the primary key absorbs it: one link, no error
			const id = randomUUID()
			seededDocumentIds.push(id)

			const count = await withOrgScope(async client => {
				const companyId = await seedCompany(client)
				await client.query(
					`INSERT INTO documents (id, organization_id, type, content)
					 VALUES ($1::uuid, $2, 'general', 'Test content')`,
					[id, orgId],
				)
				for (let attempt = 0; attempt < 2; attempt += 1) {
					await client.query(
						`INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
						 VALUES ($1, $2::uuid, 'companies', $3::uuid)
						 ON CONFLICT DO NOTHING`,
						[orgId, id, companyId],
					)
				}
				const result = await client.query<{ count: string }>(
					`SELECT count(*)::text AS count FROM document_links WHERE document_id = $1::uuid`,
					[id],
				)
				return result.rows[0]?.count
			})

			expect(count).toBe('1')
		})
	})

	describe('when the document INSERT omits organization_id', () => {
		it('should fail because the column is NOT NULL', async () => {
			// GIVEN an INSERT with no organization_id column in the list
			// WHEN it runs as app_user with app.current_org_id set
			// THEN it fails: the column is NOT NULL with no default, so a row
			//      that no policy could ever match never lands
			const id = randomUUID()

			await expect(
				withOrgScope(async client => {
					await client.query(
						`INSERT INTO documents (id, type, content)
						 VALUES ($1::uuid, 'general', 'Bug Repro')`,
						[id],
					)
				}),
			).rejects.toThrow(
				/null value in column "organization_id"|row.level security/i,
			)
		})
	})

	describe('when a filing claims to belong to another organisation', () => {
		it('should be refused by the link policy', async () => {
			// GIVEN a document in this organisation
			// WHEN a link is written carrying somebody else's organisation id —
			//      the shape a bug or a crafted call would produce, since
			//      subject_id has no foreign key to vouch for it
			// THEN the WITH CHECK clause rejects it, so the link table cannot
			//      become a way to reach across organisations
			const id = randomUUID()
			seededDocumentIds.push(id)

			await expect(
				withOrgScope(async client => {
					const companyId = await seedCompany(client)
					await client.query(
						`INSERT INTO documents (id, organization_id, type, content)
						 VALUES ($1::uuid, $2, 'general', 'Test content')`,
						[id, orgId],
					)
					await client.query(
						`INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
						 VALUES ($1, $2::uuid, 'companies', $3::uuid)`,
						['some-other-org', id, companyId],
					)
				}),
			).rejects.toThrow(/row.level security/i)
		})
	})
})
