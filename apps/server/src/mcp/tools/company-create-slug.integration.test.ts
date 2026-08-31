// Live-DB integration test for the web address a new company is filed under.
// Driven through the real toolkit handlers the way a `tools/call` would, inside
// the same org RLS scope (`enterOrgScope`) the /mcp middleware applies.
//
// The case that matters is the one seen on production: an assistant guessed a web
// address from an accented name, wrote the accent into it, and the whole call was
// refused — three companies rejected because one of them was called "Calderería
// Sentmenat". Accented names are everyday input in these markets, so the caller
// supplies an address only when it wants a particular one.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Cause, Effect, Layer, ManagedRuntime, Stream } from 'effect'
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

// Every name this suite creates carries the marker, so teardown can find its rows
// whatever web address they ended up under — which is the very thing under test.
const MARKER = `slug-verify-${randomUUID()}`

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

// What the tool actually said, rather than the whole failure printed out. A
// stringified cause carries stack frames and SQL, so a substring check against it
// passes on almost any error — including the ones a test is meant to catch.
const toolMessageOf = (cause: Cause.Cause<unknown>): string => {
	const spoken = Cause.squash(cause)
	return isToolMessage(spoken)
		? spoken.message
		: `not a message written for the caller: ${String(spoken)}`
}

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
			Effect.succeed({ ok: false as const, message: toolMessageOf(cause) }),
		),
	)

const createCompanies = (
	companies: ReadonlyArray<{ readonly name: string; readonly slug?: string }>,
): Promise<Outcome> =>
	runInOrg(
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			return yield* collect(
				yield* toolkit.handle('create_companies', { companies }),
			)
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(Handlers),
			Effect.catchCause(cause =>
				Effect.succeed({ ok: false as const, message: toolMessageOf(cause) }),
			),
		),
	)

const createdSlugs = (outcome: Outcome): ReadonlyArray<string> => {
	if (!outcome.ok) return []
	const created = outcome.result?.['created']
	return Array.isArray(created)
		? created.map(row => String((row as { slug?: unknown }).slug ?? ''))
		: []
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
	await pool.query('DELETE FROM companies WHERE name LIKE $1', [`%${MARKER}%`])
	await runtime.dispose()
	await pool.end()
})

describe('create_companies — the web address a company is filed under', () => {
	describe('when a name carries an accent and no address is supplied', () => {
		it('should file it under the plain-letter form rather than refuse the call', async () => {
			// GIVEN a batch where one company is named the way it is actually written
			// in this market, sent between two companies that are fine
			// WHEN the batch is created
			const result = await createCompanies([
				{ name: `Fusteria Miquel ${MARKER}` },
				{ name: `Calderería Sentmenat ${MARKER}` },
				{ name: `Tallers Puig ${MARKER}` },
			])

			// THEN all three land. On production the accented one was refused for its
			// address and took the other two down with it, because one bad element
			// fails the whole call
			expect(result.ok).toBe(true)
			const slugs = createdSlugs(result)
			expect(slugs).toHaveLength(3)
			expect(slugs.some(slug => slug.startsWith('caldereria-sentmenat'))).toBe(
				true,
			)
		})
	})

	describe('when a name has no plain letters in it at all', () => {
		it('should still file it, under an address that stays the same', async () => {
			// GIVEN a Chinese company
			const name = `北京科技有限公司 ${MARKER}`

			// WHEN it is sent twice, in two separate calls
			const first = await createCompanies([{ name }])
			const second = await createCompanies([{ name }])

			// THEN the first lands and the second is recognised as the same company
			// rather than written again. An address picked at random would file a fresh
			// row on every resend, leaving one company on file several times over
			expect(createdSlugs(first)).toHaveLength(1)
			expect(createdSlugs(second)).toHaveLength(0)
			const skipped = second.ok ? second.result?.['skipped'] : null
			expect(Array.isArray(skipped) ? skipped.length : 0).toBe(1)
		})
	})

	describe('when the caller does supply an address', () => {
		it('should use it rather than working one out', async () => {
			// GIVEN a caller that wants a particular web address
			const slug = `chosen-address-${MARKER.slice(-8)}`

			// WHEN the company is created with it
			const result = await createCompanies([
				{ name: `Somebody Else ${MARKER}`, slug },
			])

			// THEN that address is what it gets — asking for one is how a caller
			// chooses, and the worked-out address only fills a gap
			expect(createdSlugs(result)).toEqual([slug])
		})
	})
})
