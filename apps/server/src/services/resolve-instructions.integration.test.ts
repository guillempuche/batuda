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

import {
	clearUserDefaultStack,
	getDefaultStacks,
	resolveInstructions,
	setDefaultStack,
} from '@batuda/instructions'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

const ORG = `ri-org-${randomUUID()}`
const U1 = `ri-u1-${randomUUID()}`
const U2 = `ri-u2-${randomUUID()}`
const U3 = `ri-u3-${randomUUID()}`
const E1 = `ri-e1-${randomUUID()}`
const E2 = `ri-e2-${randomUUID()}`
const E4 = `ri-e4-${randomUUID()}`
const ORG_OBJ = { id: ORG, name: 'ri', slug: 'ri' }

let orgTemplate = ''
let userTemplate = ''
let u2Personal = ''
let e1Template = ''
let e2Template = ''

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
					// E1 extends the org default with one personal addition (delta = [e1]).
					const e1t = yield* sql<{ id: string }>`
							INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
							VALUES (${ORG}, ${E1}, 'E1', 'e1 body', ${E1}) RETURNING id`
					const e1s = yield* sql<{ id: string }>`
							INSERT INTO agent_default_stacks (organization_id, owner_user_id, agent, composition)
							VALUES (${ORG}, ${E1}, 'research', 'extend') RETURNING id`
					yield* sql`
							INSERT INTO agent_default_stack_items (organization_id, stack_id, template_id, position)
							VALUES (${ORG}, ${e1s[0]?.id ?? ''}, ${e1t[0]?.id ?? ''}, 0)`
					// E2 extends but re-lists the org template ahead of its own (dedup case).
					const e2t = yield* sql<{ id: string }>`
							INSERT INTO instruction_templates (organization_id, owner_user_id, name, body, created_by)
							VALUES (${ORG}, ${E2}, 'E2', 'e2 body', ${E2}) RETURNING id`
					const e2s = yield* sql<{ id: string }>`
							INSERT INTO agent_default_stacks (organization_id, owner_user_id, agent, composition)
							VALUES (${ORG}, ${E2}, 'research', 'extend') RETURNING id`
					yield* sql`
							INSERT INTO agent_default_stack_items (organization_id, stack_id, template_id, position)
							VALUES (${ORG}, ${e2s[0]?.id ?? ''}, ${org}, 0)`
					yield* sql`
							INSERT INTO agent_default_stack_items (organization_id, stack_id, template_id, position)
							VALUES (${ORG}, ${e2s[0]?.id ?? ''}, ${e2t[0]?.id ?? ''}, 1)`
					// E4 has an extend stack with no additions of its own (empty delta).
					yield* sql`
							INSERT INTO agent_default_stacks (organization_id, owner_user_id, agent, composition)
							VALUES (${ORG}, ${E4}, 'research', 'extend')`
					return {
						org,
						user,
						u2: u2[0]?.id ?? '',
						e1: e1t[0]?.id ?? '',
						e2: e2t[0]?.id ?? '',
					}
				}),
			)
		}),
	)
	orgTemplate = ids.org
	userTemplate = ids.user
	u2Personal = ids.u2
	e1Template = ids.e1
	e2Template = ids.e2
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

	describe('when a user stack extends the org default', () => {
		it('should resolve the org default first, then the user additions', async () => {
			// GIVEN E1 has an extend stack that adds one personal template
			const result = await resolveAs(E1)
			// THEN the live org default leads and the addition follows
			expect(result.source).toBe('user')
			expect(result.templateIds).toEqual([orgTemplate, e1Template])
			expect(result.segments).toEqual(['org body', 'e1 body'])
		})

		it('should keep the org template in its slot when the delta re-lists it', async () => {
			// GIVEN E2's extend delta re-lists the org template ahead of its own
			const result = await resolveAs(E2)
			// THEN the org template keeps its lead slot and the duplicate is dropped
			expect(result.source).toBe('user')
			expect(result.templateIds).toEqual([orgTemplate, e2Template])
			expect(result.segments).toEqual(['org body', 'e2 body'])
		})

		it('should resolve to the org default alone when the extend delta is empty', async () => {
			// GIVEN E4 has an extend stack with no additions of its own
			const result = await resolveAs(E4)
			// THEN only the live org default resolves; the source stays the user stack
			expect(result.source).toBe('user')
			expect(result.templateIds).toEqual([orgTemplate])
			expect(result.segments).toEqual(['org body'])
		})

		it('should be bypassed entirely by a per-run override', async () => {
			// GIVEN E1 (an extend user) passes an explicit override
			const result = await resolveAs(E1, [e1Template])
			// THEN the override wins and the org default is not composed in
			expect(result.source).toBe('override')
			expect(result.templateIds).toEqual([e1Template])
			expect(result.segments).toEqual(['e1 body'])
		})

		// Runs last: it edits the shared org template to prove the org base is live.
		it('should track a live edit to the org default it extends', async () => {
			// GIVEN E1's extend resolution layers on the org default
			const before = await resolveAs(E1)
			// WHEN the org default's template is edited
			await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`SET LOCAL ROLE app_service`
							yield* sql`
								UPDATE instruction_templates
								SET body = 'edited org body', updated_at = now() + interval '1 second'
								WHERE id = ${orgTemplate}`
						}),
					)
				}),
			)
			const after = await resolveAs(E1)
			// THEN E1's fingerprint changes and the edited org body resolves in the org slot
			expect(after.fingerprint).not.toBe(before.fingerprint)
			expect(after.segments).toEqual(['edited org body', 'e1 body'])
		})
	})

	describe('default-stack composition (set, then read it back)', () => {
		const setStackFor = (
			userId: string,
			composition: 'replace' | 'extend',
			templateIds: ReadonlyArray<string>,
		) =>
			runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, { org: ORG_OBJ, userId })(
						setDefaultStack({
							organizationId: ORG,
							ownerUserId: userId,
							agent: 'research',
							templateIds,
							composition,
						}),
					)
				}),
			)
		const readStacks = (userId: string) =>
			runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, { org: ORG_OBJ, userId })(
						getDefaultStacks(ORG, userId, 'research'),
					)
				}),
			)

		it('should persist composition=extend and read it back with its items', async () => {
			// GIVEN a fresh user saves an extend stack over the org template
			const me = `ri-s1-${randomUUID()}`
			const result = await setStackFor(me, 'extend', [orgTemplate])
			expect(result.ok).toBe(true)
			// THEN reading it back reports extend + the stored items
			const stacks = await readStacks(me)
			expect(stacks.user?.composition).toBe('extend')
			expect(stacks.user?.templateIds).toEqual([orgTemplate])
		})

		it('should overwrite the composition when an existing stack is re-saved', async () => {
			// GIVEN a user's stack is extend, then re-saved as replace
			const me = `ri-s2-${randomUUID()}`
			await setStackFor(me, 'extend', [orgTemplate])
			await setStackFor(me, 'replace', [orgTemplate])
			// THEN the upsert UPDATE wrote the new composition
			const stacks = await readStacks(me)
			expect(stacks.user?.composition).toBe('replace')
		})

		it('should leave no user stack after it is cleared', async () => {
			// GIVEN a user with an extend stack
			const me = `ri-s3-${randomUUID()}`
			await setStackFor(me, 'extend', [orgTemplate])
			// WHEN it is cleared
			await runRoot(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, { org: ORG_OBJ, userId: me })(
						clearUserDefaultStack(ORG, me, 'research'),
					)
				}),
			)
			// THEN they inherit the org default again (no user stack)
			const stacks = await readStacks(me)
			expect(stacks.user).toBeNull()
		})
	})
})
