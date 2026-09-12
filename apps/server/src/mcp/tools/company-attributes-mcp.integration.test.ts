// Live-DB integration test for the attribute values a company tool carries:
// what create_companies and update_company store under a declared key, how a
// value is refused, and how search_companies narrows by one. Driven through the
// real toolkit handlers inside the org RLS scope the /mcp middleware applies,
// against the seeded `taller` org. Requires $DATABASE_URL.

import { randomUUID } from 'node:crypto'

import { Cause, Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { Tool } from 'effect/unstable/ai'
import { FetchHttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { applyTestEnv } from '../../test-env'
import { CurrentUser } from '../current-user'
import { isToolMessage } from '../tool-message'
import { CompanyHandlersLive, CompanyTools } from './companies'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const suffix = randomUUID().slice(0, 8)
const MARKER = `attr-tool-${suffix}`
const SITES = `sites_${suffix}`
const FRANCHISE = `franchise_${suffix}`
const CRM = `crm_${suffix}`
const PAGE = `https://acme.example/${suffix}/about`

type Org = { id: string; name: string; slug: string }
type Tools = typeof CompanyTools.tools

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
let otherOrg: Org
let actorId: string

type Outcome =
	| { ok: true; result: Record<string, unknown> | null }
	| { ok: false; message: string }

// What the tool actually said, rather than the whole failure printed out.
const toolMessageOf = (cause: Cause.Cause<unknown>): string => {
	const spoken = Cause.squash(cause)
	return isToolMessage(spoken)
		? spoken.message
		: `not a message written for the caller: ${String(spoken)}`
}

// Runs one tool call inside the actor's org scope, keeping what the tool said
// when it refused.
const invoke = <E, R1, R2>(
	handle: Effect.Effect<
		Stream.Stream<{ readonly result: unknown }, E, R1>,
		E,
		R2
	>,
): Promise<Outcome> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: actorId })(
				Effect.gen(function* () {
					const stream = yield* handle
					return yield* Stream.runCollect(stream).pipe(
						Effect.map(([first]) => ({
							ok: true as const,
							result: (first?.result ?? null) as Record<string, unknown> | null,
						})),
					)
				}).pipe(
					Effect.provideService(CurrentUser, {
						userId: actorId,
						email: `${actorId}@verify.local`,
						name: 'Verifier',
						isAgent: true,
					}),
					Effect.provide(Handlers),
					Effect.catchCause(cause =>
						Effect.succeed({
							ok: false as const,
							message: toolMessageOf(cause),
						}),
					),
				) as Effect.Effect<Outcome, never, SqlClient.SqlClient | CurrentOrg>,
			)
		}),
	)

const createCompanies = (params: Tool.Parameters<Tools['create_companies']>) =>
	invoke(
		Effect.flatMap(CompanyTools, toolkit =>
			toolkit.handle('create_companies', params),
		),
	)
const updateCompany = (params: Tool.Parameters<Tools['update_company']>) =>
	invoke(
		Effect.flatMap(CompanyTools, toolkit =>
			toolkit.handle('update_company', params),
		),
	)
const searchCompanies = (params: Tool.Parameters<Tools['search_companies']>) =>
	invoke(
		Effect.flatMap(CompanyTools, toolkit =>
			toolkit.handle('search_companies', params),
		),
	)

const messageOf = (outcome: Outcome): string =>
	outcome.ok ? `no refusal: ${JSON.stringify(outcome.result)}` : outcome.message

const readAttributes = async (slug: string) => {
	const r = await pool.query<{
		id: string
		attributes: Record<string, unknown>
	}>(
		`SELECT id, attributes FROM companies WHERE organization_id = $1 AND slug = $2 AND deleted_at IS NULL`,
		[org.id, slug],
	)
	return r.rows[0]
}

const seedRunWithPage = async (
	orgId: string,
): Promise<{ runId: string; srcId: string }> => {
	const srcId = `src_${randomUUID().slice(0, 8)}`
	await pool.query(
		`INSERT INTO sources (id, kind, provider, url, url_hash, domain, content_hash) VALUES ($1, 'web', 'test', $2, $3, 'acme.example', $4)`,
		[srcId, PAGE, `hash-${randomUUID()}`, `content-${randomUUID()}`],
	)
	const run = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by) VALUES ($1, 'q', 'succeeded', 'u1') RETURNING id`,
		[orgId],
	)
	const runId = run.rows[0]?.id as string
	await pool.query(
		`INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents) VALUES ($1, $2, $3, $4, now(), 0)`,
		[orgId, runId, srcId, PAGE],
	)
	return { runId, srcId }
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runtime = makeRuntime()
	const orgs = await pool.query<Org>(
		`SELECT id, name, slug FROM organization WHERE slug IN ('taller', 'restaurant')`,
	)
	const taller = orgs.rows.find(o => o.slug === 'taller')
	const restaurant = orgs.rows.find(o => o.slug === 'restaurant')
	if (!taller || !restaurant)
		throw new Error("demo orgs missing — run 'pnpm cli seed'")
	org = taller
	otherOrg = restaurant
	const m = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[org.id],
	)
	actorId = m.rows[0]?.userId as string
	// A stack of this suite's own, so the seeded default's cap is never touched.
	const stack = await pool.query<{ id: string }>(
		`INSERT INTO instruction_stacks (organization_id, owner_user_id, agent, name, is_default) VALUES ($1, NULL, 'research', $2, false) RETURNING id`,
		[org.id, MARKER],
	)
	await pool.query(
		`INSERT INTO research_attributes (organization_id, stack_id, key, label, kind, created_by)
		 VALUES ($1, $2, $3, 'Sites', 'number', 'u1'), ($1, $2, $4, 'Franchise', 'boolean', 'u1'), ($1, $2, $5, 'CRM', 'text', 'u1')`,
		[org.id, stack.rows[0]?.id, SITES, FRANCHISE, CRM],
	)
}, 30_000)

afterAll(async () => {
	await pool
		.query(
			`DELETE FROM timeline_activity WHERE organization_id = $1 AND company_id IN (SELECT id FROM companies WHERE slug LIKE $2)`,
			[org.id, `${MARKER}%`],
		)
		.catch(() => undefined)
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [`${MARKER}%`])
	await pool.query(`DELETE FROM instruction_stacks WHERE name = $1`, [MARKER])
	await pool.query(
		`DELETE FROM research_run_sources WHERE source_id IN (SELECT id FROM sources WHERE url = $1)`,
		[PAGE],
	)
	await pool.query(
		`DELETE FROM research_runs WHERE id NOT IN (SELECT research_id FROM research_run_sources) AND query = 'q' AND created_by = 'u1' AND organization_id IN ($1, $2)`,
		[org.id, otherOrg.id],
	)
	await pool.query(`DELETE FROM sources WHERE url = $1`, [PAGE])
	await runtime.dispose()
	await pool.end()
})

describe('create_companies with attribute values', () => {
	describe('when the values sit under declared keys', () => {
		it("should store each read as its kind, as the caller's word", async () => {
			// GIVEN a number as text and a yes
			const slug = `${MARKER}-created`
			const outcome = await createCompanies({
				companies: [
					{
						name: slug,
						slug,
						attributes: { [SITES]: '4', [FRANCHISE]: 'yes' },
					},
				],
			})

			// THEN the company exists with both values, stamped as the caller's
			expect(outcome.ok).toBe(true)
			expect((await readAttributes(slug))?.attributes).toEqual({
				[SITES]: { value: 4, set_by: 'client' },
				[FRANCHISE]: { value: true, set_by: 'client' },
			})
		})
	})

	describe('when one company of a batch carries an undeclared key', () => {
		it('should refuse the call naming the key, and write no company at all', async () => {
			// GIVEN a good first company and a second under a key nobody declared
			const first = `${MARKER}-good`
			const outcome = await createCompanies({
				companies: [
					{ name: first, slug: first, attributes: { [SITES]: 1 } },
					{
						name: `${MARKER}-bad`,
						slug: `${MARKER}-bad`,
						attributes: { nobody_declared: 'x' },
					},
				],
			})

			// THEN the message names the key and neither row exists
			expect(messageOf(outcome)).toContain('"nobody_declared"')
			expect(await readAttributes(first)).toBeUndefined()
		})

		it('should refuse a value that does not read as its kind, and a run of another organisation', async () => {
			// GIVEN text under a number key, then a run that is not this org's
			const wrongKind = await createCompanies({
				companies: [
					{
						name: `${MARKER}-wk`,
						slug: `${MARKER}-wk`,
						attributes: { [SITES]: 'many' },
					},
				],
			})
			expect(messageOf(wrongKind)).toContain(`"${SITES}"`)
			const theirs = await seedRunWithPage(otherOrg.id)
			const foreign = await createCompanies({
				companies: [
					{
						name: `${MARKER}-fr`,
						slug: `${MARKER}-fr`,
						attributes: { [SITES]: 1 },
					},
				],
				research_id: theirs.runId,
			})
			expect(messageOf(foreign)).toContain('research_id')
		})
	})

	describe('when another organisation declared the key', () => {
		it('should still refuse it here', async () => {
			// GIVEN a key only the other organisation declares
			const theirsOnly = `theirs_${suffix}`
			const stack = await pool.query<{ id: string }>(
				`INSERT INTO instruction_stacks (organization_id, owner_user_id, agent, name, is_default) VALUES ($1, NULL, 'research', $2, false) RETURNING id`,
				[otherOrg.id, `${MARKER}-theirs`],
			)
			await pool.query(
				`INSERT INTO research_attributes (organization_id, stack_id, key, label, kind, created_by) VALUES ($1, $2, $3, 'Theirs', 'text', 'u1')`,
				[otherOrg.id, stack.rows[0]?.id, theirsOnly],
			)
			const outcome = await createCompanies({
				companies: [
					{
						name: `${MARKER}-x`,
						slug: `${MARKER}-x`,
						attributes: { [theirsOnly]: 'x' },
					},
				],
			})
			expect(messageOf(outcome)).toContain(`"${theirsOnly}"`)
			await pool.query(`DELETE FROM instruction_stacks WHERE id = $1`, [
				stack.rows[0]?.id,
			])
		})
	})
})

describe('update_company with attribute values', () => {
	describe('when one key is written and another set to null', () => {
		it('should merge, remove, and keep the rest', async () => {
			// GIVEN a company holding two declared keys and one nobody declares
			const slug = `${MARKER}-merge`
			await createCompanies({
				companies: [
					{ name: slug, slug, attributes: { [SITES]: 1, [CRM]: 'zoho' } },
				],
			})
			const row = await readAttributes(slug)
			await pool.query(
				`UPDATE companies SET attributes = attributes || '{"retired_key": {"value": "x", "set_by": "client"}}' WHERE id = $1`,
				[row?.id],
			)

			// WHEN sites is rewritten and the retired key removed
			const outcome = await updateCompany({
				id: row?.id as string,
				attributes: { [SITES]: 5, retired_key: null },
			})

			// THEN the crm value stayed, sites changed, the retired key is gone
			expect(outcome.ok).toBe(true)
			expect((await readAttributes(slug))?.attributes).toEqual({
				[SITES]: { value: 5, set_by: 'client' },
				[CRM]: { value: 'zoho', set_by: 'client' },
			})
		})
	})

	describe('when the values are read off a run of this organisation', () => {
		it("should record a value as the run's only where the run fetched the cited page", async () => {
			// GIVEN a run that fetched one page
			const slug = `${MARKER}-run`
			await createCompanies({ companies: [{ name: slug, slug }] })
			const row = await readAttributes(slug)
			const { runId, srcId } = await seedRunWithPage(org.id)

			// WHEN two values are written, one citing that page and one another
			const outcome = await updateCompany({
				id: row?.id as string,
				research_id: runId,
				attributes: {
					[SITES]: { value: 3, source_id: srcId, quote: 'three sites' },
					[CRM]: { value: 'zoho', source_id: 'https://never.example/opened' },
				},
			})

			// THEN the first is the run's with the page's address; the second the caller's
			expect(outcome.ok).toBe(true)
			expect((await readAttributes(slug))?.attributes).toEqual({
				[SITES]: {
					value: 3,
					source_url: PAGE,
					quote: 'three sites',
					research_id: runId,
					set_by: 'research',
				},
				[CRM]: {
					value: 'zoho',
					source_url: 'https://never.example/opened',
					set_by: 'client',
				},
			})
		})
	})
})

describe('search_companies with an attribute filter', () => {
	let numeric: string
	let dirty: string

	beforeAll(async () => {
		numeric = `${MARKER}-num`
		dirty = `${MARKER}-dirty`
		await createCompanies({
			companies: [{ name: numeric, slug: numeric, attributes: { [SITES]: 4 } }],
		})
		await createCompanies({ companies: [{ name: dirty, slug: dirty }] })
		// A value that got in under an earlier meaning of the key.
		await pool.query(
			`UPDATE companies SET attributes = $2::jsonb WHERE organization_id = $1 AND slug = $3`,
			[
				org.id,
				JSON.stringify({ [SITES]: { value: 'many', set_by: 'client' } }),
				dirty,
			],
		)
	})

	const slugsOf = (outcome: Outcome): ReadonlyArray<string> =>
		outcome.ok
			? ((outcome.result?.['items'] as ReadonlyArray<{ slug: string }>) ?? [])
					.map(c => c.slug)
					.filter(s => s.startsWith(MARKER))
			: []

	describe('when only some of the three parts are given', () => {
		it('should refuse with the words to fix it', async () => {
			// GIVEN a key with no operator and no value beside it
			const outcome = await searchCompanies({ attribute_key: SITES })

			// THEN the refusal says the three parts go together
			expect(messageOf(outcome)).toContain('go together')
		})
	})

	describe('when the operator does not fit the kind', () => {
		it('should say which operators fit', async () => {
			// GIVEN "at least" asked of a yes/no key
			const outcome = await searchCompanies({
				attribute_key: FRANCHISE,
				attribute_op: 'gte',
				attribute_value: '1',
			})

			// THEN the refusal names the operators that do fit it
			expect(messageOf(outcome)).toContain('does not fit the kind')
		})
	})

	describe('when the key is not declared', () => {
		it('should find nothing rather than refuse', async () => {
			// GIVEN a key this organisation never declared
			const outcome = await searchCompanies({
				attribute_key: 'nobody_declared',
				attribute_op: 'eq',
				attribute_value: 'x',
			})

			// THEN the list comes back empty, so a saved view outliving its
			// declaration still answers
			expect(outcome.ok).toBe(true)
			expect(slugsOf(outcome)).toEqual([])
		})
	})

	describe('when a number key is compared', () => {
		it('should match the numeric row and step over the text one', async () => {
			// GIVEN one row holding 4 under the key and one holding "many"
			const outcome = await searchCompanies({
				attribute_key: SITES,
				attribute_op: 'gte',
				attribute_value: '3',
				limit: 200,
			})

			// THEN only the number is compared, and the text one is passed over
			expect(slugsOf(outcome)).toContain(numeric)
			expect(slugsOf(outcome)).not.toContain(dirty)
		})
	})
})
