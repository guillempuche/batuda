import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'
import {
	linkDocument,
	subjectsForDocument,
	unlinkSubject,
} from './documents.js'

// `document_links.subject_id` carries no foreign key — one key cannot point at
// five tables — so nothing in the database stops a link pointing at a record
// that does not exist, or at one belonging to somebody else. `linkDocument` is
// the only thing standing between those two cases and a stored link, which
// makes it worth exercising against a real database rather than a mock.
//
// Runs through `enterOrgScope`, so the app_user role and the org GUC are in
// force exactly as they are on a request.

const ORG_A = `docs-a-${randomUUID()}`
const ORG_B = `docs-b-${randomUUID()}`
const ORG_A_OBJ = { id: ORG_A, name: 'docs-a', slug: 'docs-a' }

let documentId = ''
let companyInOrgA = ''
let companyInOrgB = ''

const runRoot = <A>(
	eff: Effect.Effect<A, unknown, SqlClient.SqlClient>,
): Promise<A> =>
	Effect.runPromise(
		eff.pipe(Effect.orDie, Effect.provide(PgLive)) as Effect.Effect<
			A,
			never,
			never
		>,
	)

// Seeding runs outside the org scope, as the migration-owning role, so both
// organisations' fixtures can be written from one place.
const seed = () =>
	runRoot(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const [docRow] = yield* sql<{ id: string }>`
				INSERT INTO documents (organization_id, type, content)
				VALUES (${ORG_A}, 'general', 'Guard fixture') RETURNING id
			`
			documentId = docRow?.id ?? ''
			const [a] = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${ORG_A}, ${`docs-a-${randomUUID()}`}, 'In org A') RETURNING id
			`
			companyInOrgA = a?.id ?? ''
			const [b] = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${ORG_B}, ${`docs-b-${randomUUID()}`}, 'In org B') RETURNING id
			`
			companyInOrgB = b?.id ?? ''
		}),
	)

const linkAsOrgA = (subjectId: string) =>
	runRoot(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: ORG_A_OBJ })(
				linkDocument(sql, ORG_A, documentId, 'companies', subjectId),
			)
		}),
	)

describe('filing a document against a record', () => {
	beforeAll(async () => {
		await seed()
	})

	afterAll(async () => {
		await runRoot(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`DELETE FROM documents WHERE organization_id IN (${ORG_A}, ${ORG_B})`
				yield* sql`DELETE FROM companies WHERE organization_id IN (${ORG_A}, ${ORG_B})`
			}),
		)
	})

	describe('when the record is real and belongs to the same organisation', () => {
		it('should store the filing', async () => {
			// GIVEN a company in the caller's own organisation
			// WHEN the document is filed against it
			const filed = await linkAsOrgA(companyInOrgA)
			// THEN it is accepted and readable back
			expect(filed).toBe(true)
			const subjects = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* subjectsForDocument(sql, documentId)
				}),
			)
			expect(subjects.map(s => s.subjectId)).toContain(companyInOrgA)
		})

		it('should absorb a repeat rather than fail', async () => {
			// GIVEN the same document already filed there
			// WHEN the same pair is filed again, as re-filing does
			// THEN it succeeds and leaves one filing, not two
			expect(await linkAsOrgA(companyInOrgA)).toBe(true)
			const subjects = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* subjectsForDocument(sql, documentId)
				}),
			)
			expect(subjects.filter(s => s.subjectId === companyInOrgA)).toHaveLength(
				1,
			)
		})
	})

	describe('when the record belongs to another organisation', () => {
		it('should refuse, so a filing cannot reach across organisations', async () => {
			// GIVEN a company id that is real but owned by a different organisation
			// WHEN the caller tries to file their document against it — the shape a
			//      guessed or leaked id would take
			const filed = await linkAsOrgA(companyInOrgB)
			// THEN it is refused, and nothing is written
			expect(filed).toBe(false)
			const subjects = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* subjectsForDocument(sql, documentId)
				}),
			)
			expect(subjects.map(s => s.subjectId)).not.toContain(companyInOrgB)
		})
	})

	describe('when the document belongs to another organisation', () => {
		it('should refuse, rather than reveal that the id is real', async () => {
			// GIVEN a document owned by a different organisation. The caller cannot
			// read it, but the link's foreign key is checked by the database itself
			// and does not apply that restriction — so the write would otherwise
			// succeed and answer "does this id exist?" for free.
			const otherDocument = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const [row] = yield* sql<{ id: string }>`
						INSERT INTO documents (organization_id, type, content)
						VALUES (${ORG_B}, 'general', 'Not yours') RETURNING id
					`
					return row?.id ?? ''
				}),
			)

			// WHEN the caller files that document against their own company
			const filed = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, { org: ORG_A_OBJ })(
						linkDocument(sql, ORG_A, otherDocument, 'companies', companyInOrgA),
					)
				}),
			)

			// THEN it is refused, and no link exists to point at it
			expect(filed).toBe(false)
			const links = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql<{
						count: string
					}>`SELECT count(*)::text AS count FROM document_links WHERE document_id = ${otherDocument}`
				}),
			)
			expect(links[0]?.count).toBe('0')
		})
	})

	describe('when the record does not exist at all', () => {
		it('should refuse rather than leave a filing pointing at nothing', async () => {
			// GIVEN an id no company carries
			// WHEN the document is filed against it
			// THEN it is refused — the database would have accepted the row, since
			//      subject_id has no foreign key to check it against
			expect(await linkAsOrgA(randomUUID())).toBe(false)
		})
	})

	describe('when a record is deleted', () => {
		it('should take its filings with it', async () => {
			// GIVEN a document filed against a company
			await linkAsOrgA(companyInOrgA)
			// WHEN the delete path clears that record's filings
			await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* unlinkSubject(sql, 'companies', companyInOrgA)
				}),
			)
			// THEN none are left behind pointing at an id that no longer resolves
			const subjects = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* subjectsForDocument(sql, documentId)
				}),
			)
			expect(subjects.map(s => s.subjectId)).not.toContain(companyInOrgA)
		})
	})
})
