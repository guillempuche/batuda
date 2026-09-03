// Live-DB integration test for the filter values search_companies hands back.
//
// Driven through the real toolkit handler the way a `tools/call` would, inside
// the same org RLS scope the /mcp middleware applies. What matters here is that
// an assistant is never left guessing at a value: the options come back counted
// against the very filters the rows were read with, and are absent unless asked
// for, so an ordinary search pays nothing for them.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Schema, Stream } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'
import { foldLabel, slugFromLabel } from '@batuda/domain'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { applyTestEnv } from '../../test-env'
import { CurrentUser } from '../current-user'
import {
	CompanyFilterOptions,
	CompanyHandlersLive,
	CompanyTools,
} from './companies'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const TAG = `mcpfacets-${randomUUID().slice(0, 8)}`

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

const runInOrg = <A, E>(
	body: Effect.Effect<A, E, CurrentOrg | SqlClient.SqlClient>,
): Promise<A> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: actorId })(body)
		}),
	)

const search = (
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> =>
	runInOrg(
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			const stream = yield* toolkit.handle('search_companies', params)
			const [first] = yield* Stream.runCollect(stream)
			return (first?.result ?? {}) as Record<string, unknown>
		}).pipe(
			Effect.provideService(CurrentUser, {
				userId: actorId,
				email: `${actorId}@facets.local`,
				name: 'Facets',
				isAgent: true,
			}),
			Effect.provide(Handlers),
			Effect.orDie,
		) as Effect.Effect<
			Record<string, unknown>,
			never,
			CurrentOrg | SqlClient.SqlClient
		>,
	)

// Written the way the product writes one, through the same two helpers: the
// filter resolves a trade by its folded name.
const tradeSlug = (name: string): string => slugFromLabel(`${TAG} ${name}`)

const insertTrade = async (name: string): Promise<string> => {
	const label = `${TAG} ${name}`
	const r = await pool.query<{ id: string }>(
		`INSERT INTO company_industries (organization_id, label, slug, folded_key)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[org.id, label, slugFromLabel(label), foldLabel(label)],
	)
	const id = r.rows[0]?.id
	if (id === undefined) throw new Error(`trade ${label} was not written`)
	return id
}

const insertCompany = async (options: {
	readonly name: string
	readonly status: string
	readonly tradeId: string
	readonly deleted?: boolean
}): Promise<void> => {
	await pool.query(
		`INSERT INTO companies (
			organization_id, slug, name, status, country, industry_id, deleted_at
		 ) VALUES ($1, $2, $2, $3, 'PT', $4, CASE WHEN $5 THEN now() ELSE NULL END)`,
		[
			org.id,
			`${TAG}-${options.name}`,
			options.status,
			options.tradeId,
			options.deleted ?? false,
		],
	)
}

type FilterOptions = typeof CompanyFilterOptions.Type

// Decoded, not asserted: this suite exists to pin the shape the tool sends, and
// a cast would keep passing after a field was renamed out from under it.
const filterOptionsOf = (result: Record<string, unknown>): FilterOptions =>
	Schema.decodeUnknownSync(CompanyFilterOptions)(result['filter_options'])

const mineTrades = (
	options: FilterOptions,
): ReadonlyArray<readonly [string, number]> =>
	options.industries
		.filter(i => i.slug.startsWith(TAG))
		.map(i => [i.slug, i.company_count] as const)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	runtime = makeRuntime()
	const orgRow = await pool.query<Org>(
		`SELECT id, name, slug FROM organization ORDER BY id LIMIT 1`,
	)
	const found = orgRow.rows[0]
	if (found === undefined) throw new Error('no organization seeded')
	org = found
	const user = await pool.query<{ id: string }>(`SELECT id FROM "user" LIMIT 1`)
	const uid = user.rows[0]?.id
	if (uid === undefined) throw new Error('no user seeded')
	actorId = uid

	const binned = await insertTrade('binned')
	const live = await insertTrade('live')
	await insertCompany({
		name: 'gone',
		status: 'client',
		tradeId: binned,
		deleted: true,
	})
	await insertCompany({ name: 'here', status: 'client', tradeId: live })
}, 60_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.query(`DELETE FROM company_industries WHERE slug LIKE $1`, [
		`${TAG}-%`,
	])
	await pool.end()
	await runtime.dispose()
})

describe('search_companies filter options', () => {
	describe('when they are not asked for', () => {
		it('should return the page alone, with no options attached', async () => {
			// GIVEN an ordinary search

			// WHEN it is run without asking for the filter values
			const result = await search({ status: ['client'], limit: 5 })

			// THEN no options come back — an assistant that did not ask pays neither
			// the extra query nor the tokens
			expect(result['items']).toBeDefined()
			expect(result['filter_options']).toBeUndefined()
		})
	})

	describe('when they are asked for', () => {
		it('should offer only trades the same search would find', async () => {
			// GIVEN one client on a live trade and one deleted client on another

			// WHEN the search asks for the filter values
			const result = await search({
				status: ['client'],
				limit: 5,
				include_filter_options: true,
			})
			const options = filterOptionsOf(result)

			// THEN the live trade is offered and the deleted one is not — a trade
			// nothing live is on is never put forward as something to narrow by
			expect(mineTrades(options)).toEqual([[tradeSlug('live'), 1]])
		})

		it('should count against the same filters the rows were read with', async () => {
			// GIVEN the same companies

			// WHEN the filter values are asked for at a stage neither company is in
			const result = await search({
				status: ['prospect'],
				limit: 5,
				include_filter_options: true,
			})
			const options = filterOptionsOf(result)

			// THEN the live trade is still named, with nothing behind it at this
			// stage — which is what tells an assistant the trade exists but this
			// search is the wrong place to look for it
			expect(mineTrades(options)).toEqual([[tradeSlug('live'), 0]])
		})
	})
})
