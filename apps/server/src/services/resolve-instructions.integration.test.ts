// Live-DB integration test for resolveInstructions — the core resolver that
// turns a run's (org, user, agent) into ordered prompt segments + a fingerprint.
// Runs through enterOrgScope (app_user + GUCs) so RLS is in force, exercising
// the precedence ladder (override > user > org > none), the RLS-drop of
// unreadable override ids, and fingerprint invalidation on edit.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on $DATABASE_URL, and
// `pnpm cli db reset && pnpm cli db migrate` so 0008 is applied.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveInstructions } from '@batuda/instructions'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

const ORG = `ri-org-${randomUUID()}`
const U1 = `ri-u1-${randomUUID()}`
const U2 = `ri-u2-${randomUUID()}`
const U3 = `ri-u3-${randomUUID()}`
const ORG_OBJ = { id: ORG, name: 'ri', slug: 'ri' }

let orgTemplate = ''
let userTemplate = ''
let u2Personal = ''

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

// Resolve as a given user inside the request scope (app_user + GUCs).
const resolveAs = (
	userId: string,
	override?: ReadonlyArray<string> | undefined,
) =>
	runRoot(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: ORG_OBJ, userId })(
				resolveInstructions({
					organizationId: ORG,
					userId,
					agent: 'research',
					overrideTemplateIds: override,
				}),
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
					const ot = yield* sql<{ id: string }>`
						INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
						VALUES (${ORG}, NULL, 'Org', 'org body', ${U1}) RETURNING id`
					const ut = yield* sql<{ id: string }>`
						INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
						VALUES (${ORG}, ${U1}, 'Mine', 'user body', ${U1}) RETURNING id`
					const u2 = yield* sql<{ id: string }>`
						INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
						VALUES (${ORG}, ${U2}, 'U2 only', 'u2 body', ${U2}) RETURNING id`
					const org = ot[0]?.id ?? ''
					const user = ut[0]?.id ?? ''
					// Org default stack → the org template.
					const os = yield* sql<{ id: string }>`
						INSERT INTO agent_default_stacks (organization_id, owner_user_id, agent)
						VALUES (${ORG}, NULL, 'research') RETURNING id`
					yield* sql`
						INSERT INTO agent_default_stack_items (organization_id, stack_id, template_id, position)
						VALUES (${ORG}, ${os[0]?.id ?? ''}, ${org}, 0)`
					// U1's own stack → the user template (replaces the org default for U1).
					const us = yield* sql<{ id: string }>`
						INSERT INTO agent_default_stacks (organization_id, owner_user_id, agent)
						VALUES (${ORG}, ${U1}, 'research') RETURNING id`
					yield* sql`
						INSERT INTO agent_default_stack_items (organization_id, stack_id, template_id, position)
						VALUES (${ORG}, ${us[0]?.id ?? ''}, ${user}, 0)`
					return { org, user, u2: u2[0]?.id ?? '' }
				}),
			)
		}),
	)
	orgTemplate = ids.org
	userTemplate = ids.user
	u2Personal = ids.u2
}, 60_000)

afterAll(async () => {
	await runRoot(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_service`
					yield* sql`DELETE FROM agent_default_stacks WHERE organization_id = ${ORG}`
					yield* sql`DELETE FROM instruction_templates WHERE organization_id = ${ORG}`
				}),
			)
		}),
	)
})

describe('resolveInstructions (live RLS)', () => {
	describe('when the user has no own stack', () => {
		it('should fall back to the org default stack', async () => {
			// GIVEN an org default stack and a user (U2) without their own
			const result = await resolveAs(U2)
			// THEN the org stack resolves
			expect(result.source).toBe('org')
			expect(result.segments).toEqual(['org body'])
			expect(result.templateIds).toEqual([orgTemplate])
		})
	})

	describe('when the user has their own stack', () => {
		it("should use the user's stack instead of the org default", async () => {
			// GIVEN U1 has their own default stack
			const result = await resolveAs(U1)
			// THEN it replaces the org default
			expect(result.source).toBe('user')
			expect(result.segments).toEqual(['user body'])
			expect(result.templateIds).toEqual([userTemplate])
		})
	})

	describe('when a per-run override is given', () => {
		it('should use the override regardless of the defaults', async () => {
			// GIVEN U1 (who has a user stack) passes an explicit override
			const result = await resolveAs(U1, [orgTemplate])
			// THEN the override wins
			expect(result.source).toBe('override')
			expect(result.segments).toEqual(['org body'])
			expect(result.templateIds).toEqual([orgTemplate])
		})
	})

	describe('when nothing applies', () => {
		it('should resolve to none in an org with no default stacks', async () => {
			// GIVEN a fresh org with no org default and a user without their own
			const emptyOrg = `ri-empty-${randomUUID()}`
			const result = await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, {
						org: { id: emptyOrg, name: 'e', slug: 'e' },
						userId: U3,
					})(
						resolveInstructions({
							organizationId: emptyOrg,
							userId: U3,
							agent: 'research',
							overrideTemplateIds: undefined,
						}),
					)
				}),
			)
			// THEN nothing is layered in
			expect(result.source).toBe('none')
			expect(result.segments).toEqual([])
			expect(result.templateIds).toEqual([])
		})
	})

	describe("when an override names a template the actor can't read", () => {
		it('should silently drop it (RLS) so it never reaches the prompt', async () => {
			// GIVEN U1 overrides with U2's personal template id (RLS-hidden from U1)
			const result = await resolveAs(U1, [u2Personal])
			// THEN the unreadable template is dropped before assembly + fingerprint
			expect(result.source).toBe('override')
			expect(result.segments).toEqual([])
			expect(result.templateIds).toEqual([])
		})
	})

	describe('when a template in the resolved stack is edited', () => {
		it('should change the fingerprint so a cached run is invalidated', async () => {
			// GIVEN U1 resolves their stack once
			const before = await resolveAs(U1)
			// WHEN the user template is edited (updated_at bumped)
			await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`SET LOCAL ROLE app_service`
							yield* sql`
								UPDATE instruction_templates
								SET body = 'edited body', updated_at = now() + interval '1 second'
								WHERE id = ${userTemplate}`
						}),
					)
				}),
			)
			const after = await resolveAs(U1)
			// THEN the fingerprint changes (and the edited body resolves)
			expect(after.fingerprint).not.toBe(before.fingerprint)
			expect(after.segments).toEqual(['edited body'])
		})
	})
})
