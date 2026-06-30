// Live-DB integration test for resolveInstructionRefs — the name-or-id resolver
// behind the MCP `instructions` per-run override. Runs through enterOrgScope
// (app_user + GUCs) so RLS is in force, proving names resolve only against the
// templates the actor can read (the org's plus their own), that an id passes
// through, and that the unknown / ambiguous failure shapes match what the tools
// hand back to the AI.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on $DATABASE_URL, and
// the instruction tables migrated.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveInstructionRefs } from '@batuda/instructions'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

const ORG = `rir-org-${randomUUID()}`
const U1 = `rir-u1-${randomUUID()}`
const U2 = `rir-u2-${randomUUID()}`
const ORG_OBJ = { id: ORG, name: 'rir', slug: 'rir' }

let orgShared = ''
let userShared = ''
let orgOnly = ''

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

// Resolve refs as a given user inside the request scope (app_user + GUCs).
const resolveAs = (userId: string, refs: ReadonlyArray<string>) =>
	runRoot(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: ORG_OBJ, userId })(
				resolveInstructionRefs(refs),
			)
		}),
	)

beforeAll(async () => {
	const ids = await runRoot(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* sql.withTransaction(
				Effect.gen(function* () {
					// app_service (BYPASSRLS) seeds across the FORCE policy.
					yield* sql`SET LOCAL ROLE app_service`
					// 'Shared' exists as both an org template and U1's personal one — a
					// name collision U1 must disambiguate.
					const os = yield* sql<{ id: string }>`
						INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
						VALUES (${ORG}, NULL, 'Shared', 'org shared', ${U1}) RETURNING id`
					const us = yield* sql<{ id: string }>`
						INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
						VALUES (${ORG}, ${U1}, 'Shared', 'u1 shared', ${U1}) RETURNING id`
					// A uniquely-named org template U1 can resolve by name.
					const oo = yield* sql<{ id: string }>`
						INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
						VALUES (${ORG}, NULL, 'OrgOnly', 'org only', ${U1}) RETURNING id`
					// U2's personal template — RLS hides it from U1, so U1 resolving
					// the name 'Secret' must come back unknown. Inserted for that
					// effect; the row id is never referenced.
					yield* sql`
						INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
						VALUES (${ORG}, ${U2}, 'Secret', 'u2 secret', ${U2})`
					return {
						orgShared: os[0]?.id ?? '',
						userShared: us[0]?.id ?? '',
						orgOnly: oo[0]?.id ?? '',
					}
				}),
			)
		}),
	)
	orgShared = ids.orgShared
	userShared = ids.userShared
	orgOnly = ids.orgOnly
}, 60_000)

afterAll(async () => {
	await runRoot(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_service`
					yield* sql`DELETE FROM instruction_templates WHERE organization_id = ${ORG}`
				}),
			)
		}),
	)
})

describe('resolveInstructionRefs (live RLS)', () => {
	describe('when a name uniquely matches a readable template', () => {
		it('should resolve the name to its id', async () => {
			// GIVEN U1 references a uniquely-named org template by name
			const result = await resolveAs(U1, ['OrgOnly'])
			// THEN the name resolves to the id
			expect(result).toEqual({ ok: true, templateIds: [orgOnly] })
		})
	})

	describe('when a ref is already an id', () => {
		it('should pass the id through without a name lookup', async () => {
			// GIVEN U1 references a template by raw id
			const result = await resolveAs(U1, [orgOnly])
			// THEN it is taken at face value (ids are never name-matched)
			expect(result).toEqual({ ok: true, templateIds: [orgOnly] })
		})
	})

	describe('when a name matches both an org and the actor’s personal template', () => {
		it('should report both candidates with their scope so the AI re-asks by id', async () => {
			// GIVEN 'Shared' exists as an org template and U1's own
			const result = await resolveAs(U1, ['Shared'])
			// THEN the collision is flagged with both readable candidates
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.unknown).toEqual([])
				expect(result.ambiguous).toHaveLength(1)
				const ref = result.ambiguous[0]
				expect(ref?.query).toBe('Shared')
				const byId = new Map(ref?.candidates.map(c => [c.id, c.scope]))
				expect(byId.get(orgShared)).toBe('org')
				expect(byId.get(userShared)).toBe('personal')
				expect(byId.size).toBe(2)
			}
		})
	})

	describe('when a name belongs only to another member', () => {
		it('should report it unknown because RLS hides it from this actor', async () => {
			// GIVEN U1 references U2's personal template by name
			const result = await resolveAs(U1, ['Secret'])
			// THEN RLS hides the row, so the name resolves to nothing
			expect(result).toEqual({ ok: false, unknown: ['Secret'], ambiguous: [] })
		})
	})

	describe('when several refs fail for different reasons at once', () => {
		it('should collect the unknown and ambiguous failures together', async () => {
			// GIVEN one bad name, one collision, and one good name in a single call
			const result = await resolveAs(U1, ['ghost', 'Shared', 'OrgOnly'])
			// THEN both failures come back so the caller fixes everything at once
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.unknown).toEqual(['ghost'])
				expect(result.ambiguous.map(a => a.query)).toEqual(['Shared'])
			}
		})
	})
})
