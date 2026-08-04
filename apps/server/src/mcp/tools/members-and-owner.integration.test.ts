// Exercises the two halves of assigning a company to a colleague end-to-end
// against a real Postgres, driven through the real toolkit handlers the way a
// `tools/call` would, inside the same org RLS scope (`enterOrgScope`) the /mcp
// middleware applies: reading the member directory, and writing an owner onto a
// company. The cross-org cases are the point of the suite — the directory and
// the owner it accepts both have to stop at the organisation boundary, or a
// company can be handed to somebody who does not work there. Uses the seeded
// `taller` and `restaurant` orgs. Requires $DATABASE_URL.

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
import { MemberHandlersLive, MemberTools } from './members'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const MARKER = `owner-verify-${randomUUID()}`

type Org = { id: string; name: string; slug: string }
type Member = { user_id: string; name: string | null; email: string }

const CompanyHandlers = CompanyHandlersLive.pipe(
	Layer.provide(CompanyService.layer),
	Layer.provide(TimelineActivityService.layer),
	Layer.provide(Geocoder.layer),
	Layer.provide(FetchHttpClient.layer),
)
const makeRuntime = () =>
	ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

let pool: pg.Pool
let runtime: ReturnType<typeof makeRuntime>
let taller: Org
let restaurant: Org
let actorId: string

const orgBySlug = async (slug: string): Promise<Org> => {
	const r = await pool.query<Org>(
		'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
		[slug],
	)
	const row = r.rows[0]
	if (!row)
		throw new Error(
			`${slug} org missing — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return row
}

const anyMemberOf = async (orgId: string): Promise<string> => {
	const r = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[orgId],
	)
	const id = r.rows[0]?.userId
	if (!id) throw new Error(`org ${orgId} has no members — run 'pnpm cli seed'`)
	return id
}

// Somebody who works in one organisation and not the other. People can belong
// to several, so a plain "member of the restaurant" may work in the workshop
// too, and would rightly be accepted as an owner there.
const memberOnlyIn = async (orgId: string, notIn: string): Promise<string> => {
	const r = await pool.query<{ userId: string }>(
		`SELECT "userId" FROM member
		 WHERE "organizationId" = $1
			 AND "userId" NOT IN (SELECT "userId" FROM member WHERE "organizationId" = $2)
		 LIMIT 1`,
		[orgId, notIn],
	)
	const id = r.rows[0]?.userId
	if (!id)
		throw new Error(
			`no user belongs to ${orgId} alone — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return id
}

// Every tool call carries who is making it; these tests are about which
// organisation the caller is in, not which colleague, so one stands in for all.
const actor = () => ({
	userId: actorId,
	email: `${actorId}@verify.local`,
	name: 'Verifier',
	isAgent: true,
})

// Runs a tool the way the MCP server does — validate params, run the handler,
// take its single result — inside the given org's RLS scope.
const callInOrg = <A, E>(
	org: Org,
	body: Effect.Effect<A, E, CurrentOrg | SqlClient.SqlClient>,
): Promise<A> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: actorId })(body)
		}),
	)

const listMembers = (
	org: Org,
	query?: string,
): Promise<ReadonlyArray<Member>> =>
	callInOrg(
		org,
		Effect.gen(function* () {
			const toolkit = yield* MemberTools
			const stream = yield* toolkit.handle(
				'list_members',
				query === undefined ? {} : { query },
			)
			const [first] = yield* Stream.runCollect(stream)
			if (first === undefined)
				return yield* Effect.die(new Error('list_members produced no result'))
			return (first.result as { members: ReadonlyArray<Member> }).members
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(MemberHandlersLive),
		),
	)

// The tool dies with a ToolMessage when an owner is refused, which is how the
// MCP layer turns a bad argument into something the caller can read.
const setOwner = (
	org: Org,
	companyId: string,
	ownerId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> =>
	callInOrg(
		org,
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			const stream = yield* toolkit.handle('update_company', {
				id: companyId,
				ownerId,
			})
			yield* Stream.runCollect(stream)
			return { ok: true as const }
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(CompanyHandlers),
			Effect.catchCause(cause =>
				Effect.succeed({ ok: false as const, message: String(cause) }),
			),
		),
	)

const seedCompany = async (orgId: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Owner Probe') RETURNING id`,
		[orgId, `${MARKER}-${randomUUID()}`],
	)
	return r.rows[0]!.id
}

const ownerOf = async (companyId: string): Promise<string | null> => {
	const r = await pool.query<{ owner_id: string | null }>(
		'SELECT owner_id FROM companies WHERE id = $1',
		[companyId],
	)
	return r.rows[0]?.owner_id ?? null
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runtime = makeRuntime()
	taller = await orgBySlug('taller')
	restaurant = await orgBySlug('restaurant')
	actorId = await anyMemberOf(taller.id)
})

afterAll(async () => {
	await pool.query('DELETE FROM companies WHERE slug LIKE $1', [`${MARKER}%`])
	await runtime.dispose()
	await pool.end()
})

describe('list_members', () => {
	describe('when read inside an organization', () => {
		it('should return the people who work there, with the ids other tools need', async () => {
			// GIVEN the seeded workshop organisation
			const members = await listMembers(taller)

			// THEN its colleagues come back, each carrying the id an owner or an
			// assignee is set by
			expect(members.length).toBeGreaterThan(0)
			for (const member of members) {
				expect(member.user_id).not.toBe('')
				expect(member.email).toContain('@')
			}
		})
	})

	describe('when another organization reads it', () => {
		it('should leave out somebody who only works in the other one', async () => {
			// GIVEN a colleague who belongs to the restaurant and nowhere else —
			// people can hold membership of several organisations, so only these
			// prove the boundary
			const outsider = await memberOnlyIn(restaurant.id, taller.id)

			// WHEN the workshop reads its directory
			const tallerIds = (await listMembers(taller)).map(m => m.user_id)

			// THEN they are not in it, though the restaurant's own directory has them
			expect(tallerIds.length).toBeGreaterThan(0)
			expect(tallerIds).not.toContain(outsider)
			expect((await listMembers(restaurant)).map(m => m.user_id)).toContain(
				outsider,
			)
		})
	})

	describe('when a query is given', () => {
		it('should match on part of an email, case-insensitively', async () => {
			// GIVEN a fragment taken from a real colleague's address
			const [first] = await listMembers(taller)
			const fragment = first!.email.slice(0, 4).toUpperCase()

			// THEN searching for it in the wrong case still finds them
			const found = await listMembers(taller, fragment)
			expect(found.map(m => m.user_id)).toContain(first!.user_id)
		})
	})

	describe('when the query matches nobody', () => {
		it('should come back empty rather than falling back to everyone', async () => {
			// GIVEN a name nobody here has
			const found = await listMembers(taller, 'zzz-nobody-by-this-name')

			// THEN the caller is told plainly that there is no match
			expect(found).toEqual([])
		})
	})
})

describe('update_company owner', () => {
	describe('when the owner works here', () => {
		it('should record them as responsible for the company', async () => {
			// GIVEN a company and a colleague from the same organisation
			const companyId = await seedCompany(taller.id)
			const [member] = await listMembers(taller)

			// WHEN they are made its owner
			const result = await setOwner(taller, companyId, member!.user_id)

			// THEN the company is theirs
			expect(result.ok).toBe(true)
			expect(await ownerOf(companyId)).toBe(member!.user_id)
		})
	})

	describe('when the owner is cleared', () => {
		it('should leave the company unowned rather than untouched', async () => {
			// GIVEN a company that already belongs to somebody
			const companyId = await seedCompany(taller.id)
			const [member] = await listMembers(taller)
			await setOwner(taller, companyId, member!.user_id)

			// WHEN the lead is released
			await setOwner(taller, companyId, null)

			// THEN nobody is responsible for it
			expect(await ownerOf(companyId)).toBeNull()
		})
	})

	describe('when the proposed owner belongs to another organization', () => {
		it('should refuse, leaving the company unowned', async () => {
			// GIVEN a company here and somebody who works somewhere else
			const companyId = await seedCompany(taller.id)
			const outsider = await memberOnlyIn(restaurant.id, taller.id)

			// WHEN that outsider is proposed as its owner
			const result = await setOwner(taller, companyId, outsider)

			// THEN the write is turned away, saying why and where to look, and the
			// company is left as it was — one handed to a stranger would show only
			// as an unfamiliar name on the lead
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.message).toContain('not a member')
			expect(result.message).toContain('list_members')
			expect(await ownerOf(companyId)).toBeNull()
		})
	})

	describe('when the proposed owner is nobody at all', () => {
		it('should refuse an invented id', async () => {
			// GIVEN an id the model made up
			const companyId = await seedCompany(taller.id)

			// WHEN it is proposed as the owner
			const result = await setOwner(
				taller,
				companyId,
				`no-such-user-${randomUUID()}`,
			)

			// THEN it is refused like any other stranger, for the same stated reason
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.message).toContain('not a member')
			expect(await ownerOf(companyId)).toBeNull()
		})
	})
})
