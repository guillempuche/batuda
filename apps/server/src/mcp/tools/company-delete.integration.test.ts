// Live-DB integration test for taking a company out of view and putting it
// back. Driven through the real toolkit handlers the way a `tools/call` would,
// inside the same org RLS scope (`enterOrgScope`) the /mcp middleware applies.
// The cases that matter are the ones a person only meets once something has
// gone wrong: a name reused while the company was away, a deleted company still
// answering reads, and people who were hidden for their own reasons coming back
// with a restore that was not about them.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { TimelineActivityService } from '../../services/timeline-activity'
import { applyTestEnv } from '../../test-env'
import { CurrentUser } from '../current-user'
import { CompanyHandlersLive, CompanyTools } from './companies'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const MARKER = `delete-verify-${randomUUID()}`

type Org = { id: string; name: string; slug: string }

const Handlers = CompanyHandlersLive.pipe(
	Layer.provide(CompanyService.layer),
	Layer.provide(TimelineActivityService.layer),
	Layer.provide(Geocoder.layer),
	Layer.provide(FetchHttpClient.layer),
)
const makeRuntime = () =>
	ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

let pool: pg.Pool
let runtime: ReturnType<typeof makeRuntime>
let org: Org
let actorId: string

type Outcome =
	| { ok: true; result: Record<string, unknown> | null }
	| { ok: false; message: string }

const runInOrg = <A, E>(
	body: Effect.Effect<A, E, CurrentOrg | SqlClient.SqlClient>,
): Promise<A> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: actorId })(body)
		}),
	)

const actor = () => ({
	userId: actorId,
	email: `${actorId}@verify.local`,
	name: 'Verifier',
	isAgent: true,
})

const collect = <E, R>(
	stream: Stream.Stream<{ readonly result: unknown }, E, R>,
): Effect.Effect<Outcome, never, R> =>
	Stream.runCollect(stream).pipe(
		Effect.map(([first]) => ({
			ok: true as const,
			result: (first?.result ?? null) as Record<string, unknown> | null,
		})),
		Effect.catchCause(cause =>
			Effect.succeed({ ok: false as const, message: String(cause) }),
		),
	)

const deleteCompany = (id: string): Promise<Outcome> =>
	runInOrg(
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			return yield* collect(yield* toolkit.handle('delete_company', { id }))
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(Handlers),
			Effect.catchCause(cause =>
				Effect.succeed({ ok: false as const, message: String(cause) }),
			),
		),
	)

const restoreCompany = (id: string): Promise<Outcome> =>
	runInOrg(
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			return yield* collect(yield* toolkit.handle('restore_company', { id }))
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(Handlers),
			Effect.catchCause(cause =>
				Effect.succeed({ ok: false as const, message: String(cause) }),
			),
		),
	)

const searchDeletedSlugs = (): Promise<ReadonlyArray<string>> =>
	runInOrg(
		Effect.gen(function* () {
			const service = yield* CompanyService
			const page = yield* service.search({
				query: MARKER,
				deleted: 'only',
				limit: 50,
			})
			return page.items.map(company => company.slug)
		}).pipe(Effect.provide(CompanyService.layer), Effect.orDie),
	)

const searchSlugs = (): Promise<ReadonlyArray<string>> =>
	runInOrg(
		Effect.gen(function* () {
			const service = yield* CompanyService
			const page = yield* service.search({ query: MARKER, limit: 50 })
			return page.items.map(company => company.slug)
		}).pipe(Effect.provide(CompanyService.layer), Effect.orDie),
	)

const seedCompany = async (suffix: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, $3, 'prospect') RETURNING id`,
		[org.id, `${MARKER}-${suffix}`, `${MARKER} ${suffix}`],
	)
	return r.rows[0]!.id
}

const seedContact = async (
	companyId: string,
	name: string,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name)
		 VALUES ($1, $2, $3) RETURNING id`,
		[org.id, companyId, `${MARKER}-${name}`],
	)
	return r.rows[0]!.id
}

const isDeleted = async (table: string, id: string): Promise<boolean> => {
	const r = await pool.query<{ deleted: boolean }>(
		`SELECT deleted_at IS NOT NULL AS deleted FROM ${table} WHERE id = $1`,
		[id],
	)
	return r.rows[0]?.deleted ?? false
}

const timelineKinds = async (
	companyId: string,
): Promise<ReadonlyArray<string>> => {
	const r = await pool.query<{ kind: string }>(
		`SELECT kind FROM timeline_activity WHERE company_id = $1 ORDER BY occurred_at`,
		[companyId],
	)
	return r.rows.map(row => row.kind)
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runtime = makeRuntime()
	const o = await pool.query<Org>(
		`SELECT id, name, slug FROM organization WHERE slug = 'taller' LIMIT 1`,
	)
	const row = o.rows[0]
	if (!row) throw new Error("taller org missing — run 'pnpm cli seed'")
	org = row
	const m = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[org.id],
	)
	actorId = m.rows[0]!.userId
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM timeline_activity WHERE company_id IN
		(SELECT id FROM companies WHERE slug LIKE $1)`,
		[`${MARKER}%`],
	)
	await pool.query('DELETE FROM contacts WHERE name LIKE $1', [`${MARKER}%`])
	await pool.query('DELETE FROM companies WHERE slug LIKE $1', [`${MARKER}%`])
	await runtime.dispose()
	await pool.end()
})

describe('delete_company', () => {
	describe('when a company is deleted', () => {
		it('should take it and its people out of view, and say how many went', async () => {
			// GIVEN a company with two people on file
			const companyId = await seedCompany('basic')
			const contactId = await seedContact(companyId, 'basic-a')
			await seedContact(companyId, 'basic-b')
			expect(await searchSlugs()).toContain(`${MARKER}-basic`)

			// WHEN it is deleted
			const result = await deleteCompany(companyId)

			// THEN it leaves the lists, its people go with it, and the caller is
			// told how many so it can say so without counting
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.result?.['contacts_affected']).toBe(2)
			expect(await searchSlugs()).not.toContain(`${MARKER}-basic`)
			expect(await isDeleted('contacts', contactId)).toBe(true)
		})
	})

	describe('when it is already deleted', () => {
		it('should say so rather than pretend to delete it twice', async () => {
			const companyId = await seedCompany('twice')
			await deleteCompany(companyId)

			const again = await deleteCompany(companyId)
			expect(again.ok).toBe(false)
			if (again.ok) return
			expect(again.message).toContain('already deleted')
		})
	})
})

describe('finding a company again after it is deleted', () => {
	describe('when somebody needs to undo a deletion', () => {
		it('should be findable among the deleted ones, since restore needs its id', async () => {
			// GIVEN a company deleted a while ago, whose id nobody wrote down — a
			// deleted company answers to no name, so if it cannot be listed there is
			// no way back at all
			const companyId = await seedCompany('findable')
			await deleteCompany(companyId)

			// WHEN the deleted ones are asked for
			const deleted = await searchDeletedSlugs()

			// THEN it is there to be picked, and the live list still does not show it
			expect(deleted).toContain(`${MARKER}-findable`)
			expect(await searchSlugs()).not.toContain(`${MARKER}-findable`)
		})
	})
})

describe('restore_company', () => {
	describe('when a deleted company is restored', () => {
		it('should bring it and its people back', async () => {
			// GIVEN a deleted company
			const companyId = await seedCompany('restore')
			const contactId = await seedContact(companyId, 'restore-a')
			await deleteCompany(companyId)

			// WHEN it is restored
			const result = await restoreCompany(companyId)

			// THEN the company and the person hidden with it are both back
			expect(result.ok).toBe(true)
			expect(await searchSlugs()).toContain(`${MARKER}-restore`)
			expect(await isDeleted('contacts', contactId)).toBe(false)
		})
	})

	describe('when the name was taken while it was away', () => {
		it('should refuse in words rather than fail as a server fault', async () => {
			// GIVEN a company deleted, and its name reused by another — which the
			// released name is meant to allow
			const companyId = await seedCompany('taken')
			await deleteCompany(companyId)
			const replacement = await pool.query(
				`INSERT INTO companies (organization_id, slug, name)
				 VALUES ($1, $2, 'Replacement') RETURNING id`,
				[org.id, `${MARKER}-taken`],
			)
			expect(replacement.rowCount).toBe(1)

			// WHEN the original is restored
			const result = await restoreCompany(companyId)

			// THEN it is refused with something the caller can act on, and the
			// company stays away rather than half-restored
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.message).toContain('Rename')
			expect(await isDeleted('companies', companyId)).toBe(true)
		})
	})

	describe('when a person was removed on their own account', () => {
		it('should leave them gone, since this restore is not about them', async () => {
			// GIVEN a contact hidden before the company was deleted, at a different
			// instant from the one the deletion stamps
			const companyId = await seedCompany('precision')
			const earlier = await seedContact(companyId, 'precision-earlier')
			await pool.query(
				`UPDATE contacts SET deleted_at = now() - interval '1 day' WHERE id = $1`,
				[earlier],
			)
			const withCompany = await seedContact(companyId, 'precision-with')
			await deleteCompany(companyId)

			// WHEN the company comes back
			await restoreCompany(companyId)

			// THEN only the person the deletion hid returns
			expect(await isDeleted('contacts', withCompany)).toBe(false)
			expect(await isDeleted('contacts', earlier)).toBe(true)
		})
	})
})

describe('editing a company that was deleted', () => {
	describe('when an assistant tries to change one', () => {
		it('should refuse, write nothing, and leave no trace on its history', async () => {
			// GIVEN a deleted company carrying an address and a trade — both are
			// written before the row itself, so a check in the wrong place would
			// let them land on a company nobody can see
			const companyId = await seedCompany('noedit')
			await deleteCompany(companyId)
			const historyBefore = (await timelineKinds(companyId)).length

			// WHEN an edit is attempted
			const result = await runInOrg(
				Effect.gen(function* () {
					const toolkit = yield* CompanyTools
					return yield* collect(
						yield* toolkit.handle('update_company', {
							id: companyId,
							status: 'client',
							industry: 'foundry-should-not-land',
							email: 'should-not-land@example.com',
						}),
					)
				}).pipe(
					Effect.provideService(CurrentUser, actor()),
					Effect.provide(Handlers),
					Effect.catchCause(cause =>
						Effect.succeed({ ok: false as const, message: String(cause) }),
					),
				),
			)

			// THEN it is refused
			expect(result.ok).toBe(false)

			// AND nothing was written along the way: no address, and no stage
			// change recorded for an edit that never happened
			const channels = await pool.query(
				`SELECT 1 FROM channels WHERE subject_table = 'companies' AND subject_id = $1`,
				[companyId],
			)
			expect(channels.rowCount).toBe(0)
			expect((await timelineKinds(companyId)).length).toBe(historyBefore)

			// AND its stage is untouched
			const row = await pool.query<{ status: string }>(
				'SELECT status FROM companies WHERE id = $1',
				[companyId],
			)
			expect(row.rows[0]?.status).toBe('prospect')
		})
	})
})

describe('the account history', () => {
	describe('when a company is deleted and restored', () => {
		it('should record both, so the account says what happened to it', async () => {
			const companyId = await seedCompany('history')
			await seedContact(companyId, 'history-a')
			await deleteCompany(companyId)
			await restoreCompany(companyId)

			const kinds = await timelineKinds(companyId)
			expect(kinds).toContain('company_deleted')
			expect(kinds).toContain('company_restored')
		})
	})
})
