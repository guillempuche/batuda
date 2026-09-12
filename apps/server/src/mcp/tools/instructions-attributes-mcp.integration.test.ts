// Exercises the attribute declarations of manage_instructions end-to-end
// against a real Postgres, driven through the real toolkit handlers the way a
// `tools/call` would, inside the org RLS scope the /mcp middleware applies.
// Uses the seeded `taller` org: its `owner` exercises the admin gate and its
// plain `member` proves a declaration is an admin's to make. Requires
// $DATABASE_URL.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { Tool } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SessionContext } from '@batuda/controllers'
import {
	type ResolveInstructionsArgs,
	resolveInstructions,
} from '@batuda/instructions'
import { makeWorkRecord, WorkRecord } from '@batuda/observability'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import type {
	AttributeOutcome,
	StackOutcome,
} from '../../services/instructions'
import { InstructionsService } from '../../services/instructions'
import { applyTestEnv } from '../../test-env'
import {
	InstructionsMcpHandlersLive,
	InstructionsMcpTools,
} from './instructions-mcp'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
// Namespaces every row this suite creates so cleanup never touches seed data.
const MARKER = `attr-verify-${randomUUID().slice(0, 8)}-`

type Org = { id: string; name: string; slug: string }
type Tools = typeof InstructionsMcpTools.tools

const HandlersLayer = InstructionsMcpHandlersLive.pipe(
	Layer.provide(InstructionsService.layer),
)
const makeRuntime = () =>
	ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

let pool: pg.Pool
let runtime: ReturnType<typeof makeRuntime>
let taller: Org
let ownerId: string
let memberId: string

const orgBySlug = async (slug: string): Promise<Org> => {
	const result = await pool.query<Org>(
		'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
		[slug],
	)
	const row = result.rows[0]
	if (!row)
		throw new Error(
			`${slug} org missing — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return row
}

const memberWithRole = async (orgId: string, role: string): Promise<string> => {
	const r = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 AND role = $2 LIMIT 1',
		[orgId, role],
	)
	const id = r.rows[0]?.userId
	if (!id) throw new Error(`taller has no ${role} member — run 'pnpm cli seed'`)
	return id
}

const cleanup = async () => {
	// Declarations CASCADE with their stack.
	await pool.query('DELETE FROM instruction_stacks WHERE name LIKE $1', [
		`${MARKER}%`,
	])
	await pool.query('DELETE FROM companies WHERE slug LIKE $1', [`${MARKER}%`])
}

// Invokes the tool the way the MCP server does, inside the actor's org scope,
// with the request's record open so a test can read the facts left on it.
const callToolRecorded = (
	actorId: string,
	params: Tool.Parameters<Tools['manage_instructions']>,
): Promise<{ result: unknown; facts: Record<string, unknown> }> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const record = yield* makeWorkRecord
			const result = yield* enterOrgScope(sql, {
				org: taller,
				userId: actorId,
			})(
				Effect.gen(function* () {
					const toolkit = yield* InstructionsMcpTools
					const stream = yield* toolkit.handle('manage_instructions', params)
					const [first] = yield* Stream.runCollect(stream)
					return first?.result as unknown
				}).pipe(
					Effect.provideService(SessionContext, {
						userId: actorId,
						email: `${actorId}@verify.local`,
						name: undefined,
						isAgent: true,
					}),
					Effect.provide(HandlersLayer),
				),
			).pipe(Effect.provideService(WorkRecord, record))
			return { result, facts: yield* record.read }
		}),
	)

const callTool = (
	actorId: string,
	params: Tool.Parameters<Tools['manage_instructions']>,
): Promise<unknown> => callToolRecorded(actorId, params).then(r => r.result)

const resolveFor = (
	actorId: string,
	args: Omit<ResolveInstructionsArgs, 'organizationId' | 'userId'>,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: taller, userId: actorId })(
				resolveInstructions({
					organizationId: taller.id,
					userId: actorId,
					...args,
				}).pipe(Effect.orDie),
			)
		}),
	)

// An org-owned stack for the given agent, returning its name and id.
const createOrgStack = async (
	agent: 'research' | 'email',
): Promise<{ name: string; id: string }> => {
	const name = `${MARKER}${agent}-${randomUUID().slice(0, 6)}`
	const created = (await callTool(ownerId, {
		action: 'create_stack',
		agent,
		scope: 'org',
		name,
		templates: [],
	})) as StackOutcome
	if (created.outcome !== 'created')
		throw new Error(`stack create failed: ${JSON.stringify(created)}`)
	return { name, id: created.stack.id }
}

const declare = (
	actorId: string,
	stack: string,
	key: string,
	extra: Partial<Tool.Parameters<Tools['manage_instructions']>> = {},
) =>
	callTool(actorId, {
		action: 'create_attribute',
		agent: 'research',
		stack,
		key,
		label: extra.label ?? key,
		kind: extra.kind ?? 'number',
		...extra,
	}) as Promise<AttributeOutcome>

const outcomeOf = (result: unknown): string =>
	typeof result === 'object' && result !== null && 'outcome' in result
		? String(result.outcome)
		: String(result)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	taller = await orgBySlug('taller')
	ownerId = await memberWithRole(taller.id, 'owner')
	memberId = await memberWithRole(taller.id, 'member')
	await cleanup()
	runtime = makeRuntime()
}, 60_000)

afterAll(async () => {
	await cleanup()
	await runtime.dispose()
	await pool.end()
})

describe('declaring attributes through manage_instructions', () => {
	describe('when a plain member tries to declare, change or remove one', () => {
		it('should refuse all three as forbidden', async () => {
			// GIVEN an org research stack with one declaration
			const stack = await createOrgStack('research')
			const created = await declare(ownerId, stack.name, 'sites')
			expect(created.outcome).toBe('created')
			const id = created.outcome === 'created' ? created.attribute.id : ''

			// WHEN the member tries each write
			// THEN each is forbidden
			expect(outcomeOf(await declare(memberId, stack.name, 'towns'))).toBe(
				'forbidden',
			)
			expect(
				outcomeOf(
					await callTool(memberId, {
						action: 'update_attribute',
						id,
						label: 'X',
					}),
				),
			).toBe('forbidden')
			expect(
				outcomeOf(await callTool(memberId, { action: 'delete_attribute', id })),
			).toBe('forbidden')
		})
	})

	describe('when the owner declares on the wrong kind of stack', () => {
		it('should refuse a personal stack and an email stack', async () => {
			// GIVEN the owner's own research stack and the org's email stack
			const personal = `${MARKER}personal-${randomUUID().slice(0, 6)}`
			await callTool(ownerId, {
				action: 'create_stack',
				agent: 'research',
				scope: 'personal',
				name: personal,
				templates: [],
			})
			const email = await createOrgStack('email')

			// THEN neither may carry a declaration
			expect(outcomeOf(await declare(ownerId, personal, 'sites'))).toBe(
				'stack_not_org',
			)
			expect(
				outcomeOf(
					await callTool(ownerId, {
						action: 'create_attribute',
						agent: 'email',
						stack: email.name,
						key: 'sites',
						label: 'Sites',
						kind: 'number',
					}),
				),
			).toBe('agent_not_research')
		})
	})

	describe('when the call is missing what it needs', () => {
		it('should say so without acting', async () => {
			// GIVEN calls without a kind, an id, or an agent beside a stack
			const stack = await createOrgStack('research')
			expect(
				await callTool(ownerId, {
					action: 'create_attribute',
					agent: 'research',
					stack: stack.name,
					key: 'sites',
					label: 'Sites',
				}),
			).toMatchObject({ error: expect.stringContaining('kind') })
			expect(
				await callTool(ownerId, { action: 'update_attribute', label: 'X' }),
			).toMatchObject({ error: expect.stringContaining('id') })
			expect(
				await callTool(ownerId, { action: 'delete_attribute' }),
			).toMatchObject({ error: expect.stringContaining('id') })
			expect(
				await callTool(ownerId, {
					action: 'list_attributes',
					stack: stack.name,
				}),
			).toMatchObject({ error: expect.stringContaining('agent') })
		})

		it('should come back as a clarification for a stack that does not exist', async () => {
			// GIVEN a stack name nobody has
			const result = await declare(ownerId, `${MARKER}nowhere`, 'sites')
			// THEN nothing was written and the caller is asked to fix the ref
			expect(result).toMatchObject({
				_tag: 'instruction_clarification',
				unknown: [`${MARKER}nowhere`],
			})
		})
	})

	describe('when the declaration itself is refused', () => {
		it('should name the rule: a duplicate key, a choice without words, words on a number, a reserved key', async () => {
			// GIVEN one declaration on a stack
			const stack = await createOrgStack('research')
			await declare(ownerId, stack.name, 'sites')

			// THEN each malformed declaration answers with its code
			expect(outcomeOf(await declare(ownerId, stack.name, 'sites'))).toBe(
				'duplicate_key',
			)
			expect(
				outcomeOf(await declare(ownerId, stack.name, 'fit', { kind: 'enum' })),
			).toBe('enum_values_required')
			expect(
				outcomeOf(
					await declare(ownerId, stack.name, 'towns', { enum_values: ['a'] }),
				),
			).toBe('enum_values_not_allowed')
			expect(outcomeOf(await declare(ownerId, stack.name, 'country'))).toBe(
				'reserved_key',
			)
		})
	})

	describe('when the stack is at its cap', () => {
		it('should refuse a ninth active, allow it once one is retired, and refuse reviving at the cap', async () => {
			// GIVEN eight active declarations
			const stack = await createOrgStack('research')
			const ids: Array<string> = []
			for (let i = 0; i < 8; i += 1) {
				const created = await declare(
					ownerId,
					stack.name,
					`k${i}_${MARKER.replace(/[^a-z0-9]/g, '').slice(-6)}`,
				)
				if (created.outcome !== 'created')
					throw new Error(JSON.stringify(created))
				ids.push(created.attribute.id)
			}

			// WHEN a ninth is declared
			// THEN it is refused
			expect(outcomeOf(await declare(ownerId, stack.name, 'ninth'))).toBe(
				'too_many_active',
			)

			// WHEN one is retired and the ninth declared again
			expect(
				outcomeOf(
					await callTool(ownerId, {
						action: 'update_attribute',
						id: ids[0] ?? '',
						is_active: false,
					}),
				),
			).toBe('updated')
			expect(outcomeOf(await declare(ownerId, stack.name, 'ninth'))).toBe(
				'created',
			)

			// AND reviving the retired one at the cap is refused, while editing an
			// active one is not
			expect(
				outcomeOf(
					await callTool(ownerId, {
						action: 'update_attribute',
						id: ids[0] ?? '',
						is_active: true,
					}),
				),
			).toBe('too_many_active')
			expect(
				outcomeOf(
					await callTool(ownerId, {
						action: 'update_attribute',
						id: ids[1] ?? '',
						label: 'Renamed',
					}),
				),
			).toBe('updated')
		})
	})

	describe('when the same key is declared on a second stack of the organisation', () => {
		it('should refuse a different shape and accept the same one', async () => {
			// GIVEN a number with a unit on one stack
			const first = await createOrgStack('research')
			const second = await createOrgStack('research')
			const key = `shared_${MARKER.replace(/[^a-z0-9]/g, '').slice(-6)}`
			await declare(ownerId, first.name, key, { unit: 'sites' })

			// THEN a text twin, and a number twin with another unit, are mismatches
			expect(
				outcomeOf(await declare(ownerId, second.name, key, { kind: 'text' })),
			).toBe('kind_mismatch')
			expect(
				outcomeOf(await declare(ownerId, second.name, key, { unit: 'towns' })),
			).toBe('kind_mismatch')
			// AND the same shape is accepted
			expect(
				outcomeOf(await declare(ownerId, second.name, key, { unit: 'sites' })),
			).toBe('created')
		})
	})

	describe('when a declaration is changed or removed', () => {
		it('should keep the key, clear a unit set to null, and leave company values where they are', async () => {
			// GIVEN a declaration under a key of its own, with no value under it yet
			const stack = await createOrgStack('research')
			const key = `premises_${randomUUID().slice(0, 6)}`
			const created = await declare(ownerId, stack.name, key, { unit: 'sites' })
			if (created.outcome !== 'created')
				throw new Error(JSON.stringify(created))
			const id = created.attribute.id

			// WHEN the unit is cleared and the label changed
			const updated = (await callTool(ownerId, {
				action: 'update_attribute',
				id,
				unit: null,
				label: 'Premises',
			})) as AttributeOutcome
			// THEN the key stands and the unit is gone
			expect(updated.outcome === 'updated' && updated.attribute).toMatchObject({
				key,
				unit: null,
				label: 'Premises',
			})

			// GIVEN a company now holding a value under the key
			const company = await pool.query<{ id: string }>(
				`INSERT INTO companies (organization_id, slug, name, attributes) VALUES ($1, $2, 'C', $3::jsonb) RETURNING id`,
				[
					taller.id,
					`${MARKER}co`,
					JSON.stringify({ [key]: { value: 3, set_by: 'client' } }),
				],
			)

			// WHEN it is deleted
			expect(
				outcomeOf(await callTool(ownerId, { action: 'delete_attribute', id })),
			).toBe('deleted')
			// THEN the company keeps its value and a second delete is not found
			const row = await pool.query<{ attributes: unknown }>(
				'SELECT attributes FROM companies WHERE id = $1',
				[company.rows[0]?.id],
			)
			expect(row.rows[0]?.attributes).toEqual({
				[key]: { value: 3, set_by: 'client' },
			})
			expect(
				outcomeOf(await callTool(ownerId, { action: 'delete_attribute', id })),
			).toBe('not_found')
		})
	})

	describe('when attributes are listed', () => {
		it("should list one stack, retired ones included, wrapped under items, and never another organisation's", async () => {
			// GIVEN a stack with an active and a retired declaration
			const stack = await createOrgStack('research')
			const a = await declare(ownerId, stack.name, 'sites')
			await declare(ownerId, stack.name, 'towns')
			await callTool(ownerId, {
				action: 'update_attribute',
				id: a.outcome === 'created' ? a.attribute.id : '',
				is_active: false,
			})

			// WHEN listed by stack
			const listed = (await callTool(memberId, {
				action: 'list_attributes',
				agent: 'research',
				stack: stack.name,
			})) as {
				items: ReadonlyArray<{
					key: string
					isActive: boolean
					stackName: string
				}>
			}
			// THEN both come back under items, naming the stack
			expect(listed.items.map(i => [i.key, i.isActive])).toEqual([
				['sites', false],
				['towns', true],
			])
			expect(listed.items[0]?.stackName).toBe(stack.name)

			// AND listing by agent alone includes them among the org's research declarations
			const byAgent = (await callTool(memberId, {
				action: 'list_attributes',
				agent: 'research',
			})) as { items: ReadonlyArray<{ stackName: string }> }
			expect(byAgent.items.some(i => i.stackName === stack.name)).toBe(true)
		})
	})
})

describe("when another writer holds the organisation's declarations", () => {
	it('should wait for them before declaring', async () => {
		// GIVEN a transaction holding the lock every declaration write takes
		const stack = await createOrgStack('research')
		const holder = await pool.connect()
		await holder.query('BEGIN')
		await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
			`research_attributes:${taller.id}`,
		])

		// WHEN a declaration is attempted meanwhile
		let settled = false
		const pending = declare(
			ownerId,
			stack.name,
			`locked_${randomUUID().slice(0, 6)}`,
		).then(result => {
			settled = true
			return result
		})
		await new Promise(resolve => setTimeout(resolve, 300))

		// THEN it waits, and goes through once the lock is released
		expect(settled).toBe(false)
		await holder.query('COMMIT')
		holder.release()
		expect(outcomeOf(await pending)).toBe('created')
	})
})

describe('when a reference is not a uuid', () => {
	it('should answer not found, or an empty list, rather than fail', async () => {
		// GIVEN ids and a stack reference of the wrong shape, sent the way a
		// web address carries them, past the tool's own shape check
		const inService = <A>(
			body: (
				svc: InstructionsService['Service'],
			) => Effect.Effect<A, never, SqlClient.SqlClient>,
		) =>
			runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const svc = yield* InstructionsService
					return yield* enterOrgScope(sql, { org: taller, userId: ownerId })(
						body(svc),
					)
				}).pipe(Effect.provide(InstructionsService.layer)),
			)

		// THEN each write is not found and the list is empty
		expect(
			(
				await inService(svc =>
					svc.updateAttribute(ownerId, 'not-a-uuid', { label: 'X' }),
				)
			).outcome,
		).toBe('not_found')
		expect(
			(await inService(svc => svc.deleteAttribute(ownerId, 'not-a-uuid')))
				.outcome,
		).toBe('not_found')
		expect(
			await inService(svc => svc.listAttributes({ stackId: 'not-a-uuid' })),
		).toEqual([])
	})
})

describe("when a declaration's outcome goes on the request's record", () => {
	it('should carry the code, refused or not', async () => {
		// GIVEN an org research stack
		const stack = await createOrgStack('research')

		// WHEN a reserved key is refused and a plain one is created
		const refused = await callToolRecorded(ownerId, {
			action: 'create_attribute',
			agent: 'research',
			stack: stack.name,
			key: 'industry',
			label: 'Industry',
			kind: 'text',
		})
		const created = await callToolRecorded(ownerId, {
			action: 'create_attribute',
			agent: 'research',
			stack: stack.name,
			key: `noted_${randomUUID().slice(0, 6)}`,
			label: 'Noted',
			kind: 'text',
		})

		// THEN each record names the outcome
		expect(outcomeOf(refused.result)).toBe('reserved_key')
		expect(refused.facts['attribute.declare.outcome']).toBe('reserved_key')
		expect(created.facts['attribute.declare.outcome']).toBe('created')
	})
})

describe('when values already sit under a key', () => {
	describe('when an admin changes how the key reads', () => {
		it('should refuse the change while any company holds a value, and allow a label change', async () => {
			// GIVEN a number declaration and a company holding a value under it
			const stack = await createOrgStack('research')
			const key = `sites_${randomUUID().slice(0, 6)}`
			const created = await declare(ownerId, stack.name, key)
			if (created.outcome !== 'created')
				throw new Error(JSON.stringify(created))
			await pool.query(
				`INSERT INTO companies (organization_id, slug, name, attributes) VALUES ($1, $2, 'C', $3::jsonb)`,
				[
					taller.id,
					`${MARKER}held`,
					JSON.stringify({ [key]: { value: 3, set_by: 'client' } }),
				],
			)

			// WHEN the kind is changed, then only the label
			const kind = await callTool(ownerId, {
				action: 'update_attribute',
				id: created.attribute.id,
				kind: 'text',
			})
			const label = await callTool(ownerId, {
				action: 'update_attribute',
				id: created.attribute.id,
				label: 'Premises',
			})

			// THEN the kind stays and the label moves
			expect(outcomeOf(kind)).toBe('key_in_use')
			expect(outcomeOf(label)).toBe('updated')
		})
	})

	describe('when a retired declaration still pins the key', () => {
		it('should refuse a different kind on another stack', async () => {
			// GIVEN a number declaration retired on one stack
			const first = await createOrgStack('research')
			const second = await createOrgStack('research')
			const key = `pinned_${randomUUID().slice(0, 6)}`
			const created = await declare(ownerId, first.name, key)
			if (created.outcome !== 'created')
				throw new Error(JSON.stringify(created))
			await callTool(ownerId, {
				action: 'update_attribute',
				id: created.attribute.id,
				is_active: false,
			})

			// WHEN the key is declared as text on another stack
			// THEN it is a mismatch, since values may have been written as numbers
			expect(
				outcomeOf(await declare(ownerId, second.name, key, { kind: 'text' })),
			).toBe('kind_mismatch')
			expect(outcomeOf(await declare(ownerId, second.name, key))).toBe(
				'created',
			)
		})
	})
})

describe('the research_fills_attributes switch', () => {
	describe('when set on a personal stack or an email stack', () => {
		it('should stay off', async () => {
			// GIVEN a personal research stack and an org email stack created with the switch on
			const personal = `${MARKER}sw-personal`
			const created = (await callTool(ownerId, {
				action: 'create_stack',
				agent: 'research',
				scope: 'personal',
				name: personal,
				templates: [],
				research_fills_attributes: true,
			})) as StackOutcome
			const email = (await callTool(ownerId, {
				action: 'create_stack',
				agent: 'email',
				scope: 'org',
				name: `${MARKER}sw-email`,
				templates: [],
				research_fills_attributes: true,
			})) as StackOutcome
			// THEN both stored flags are off
			expect(
				created.outcome === 'created' && created.stack.researchFillsAttributes,
			).toBe(false)
			expect(
				email.outcome === 'created' && email.stack.researchFillsAttributes,
			).toBe(false)
		})
	})

	describe('when an admin sets it on an org research stack', () => {
		it('should be honoured, refused to a member, and read by the resolver', async () => {
			// GIVEN an org research stack with a declaration
			const stack = await createOrgStack('research')
			await declare(ownerId, stack.name, 'sites')

			// WHEN a member tries to switch it on
			expect(
				outcomeOf(
					await callTool(memberId, {
						action: 'update_stack',
						agent: 'research',
						stack: stack.name,
						research_fills_attributes: true,
					}),
				),
			).toBe('forbidden')
			// AND the owner does
			const updated = (await callTool(ownerId, {
				action: 'update_stack',
				agent: 'research',
				stack: stack.name,
				research_fills_attributes: true,
			})) as StackOutcome
			expect(
				updated.outcome === 'updated' && updated.stack.researchFillsAttributes,
			).toBe(true)

			// THEN a run naming that stack is handed its declaration
			const resolved = await resolveFor(ownerId, {
				agent: 'research',
				overrideStackId: stack.id,
			})
			expect(resolved.stackId).toBe(stack.id)
			expect(resolved.attributeStackId).toBe(stack.id)
			expect(resolved.attributes.map(a => a.key)).toEqual(['sites'])
			expect(resolved.attributeFingerprint).not.toBe(
				(
					await resolveFor(ownerId, {
						agent: 'research',
						overrideStackId: (await createOrgStack('research')).id,
					})
				).attributeFingerprint,
			)
		})
	})
})

describe('which stack a run fills attributes from', () => {
	describe('when a run names a personal stack or only override templates', () => {
		it('should take the attributes from the org default, never the personal stack', async () => {
			// GIVEN the org's default research stack — the seeded one, or one made
			// here when an earlier suite left the organisation without one — and
			// the owner's own personal stack
			const seeded = await pool.query<{ id: string }>(
				`SELECT id FROM instruction_stacks
				 WHERE organization_id = $1 AND agent = 'research' AND owner_user_id IS NULL AND is_default`,
				[taller.id],
			)
			const defaultId =
				seeded.rows[0]?.id ??
				(await (async () => {
					const made = (await callTool(ownerId, {
						action: 'create_stack',
						agent: 'research',
						scope: 'org',
						name: `${MARKER}org-default`,
						templates: [],
						is_default: true,
					})) as StackOutcome
					if (made.outcome !== 'created') throw new Error(JSON.stringify(made))
					return made.stack.id
				})())
			const orgDefault = await pool.query<{ on: boolean }>(
				`SELECT research_fills_attributes AS "on" FROM instruction_stacks WHERE id = $1`,
				[defaultId],
			)
			const active = await pool.query<{ key: string }>(
				`SELECT key FROM research_attributes WHERE stack_id = $1 AND is_active ORDER BY created_at, key`,
				[defaultId],
			)
			const expected = orgDefault.rows[0]?.on ? active.rows.map(r => r.key) : []
			const personal = `${MARKER}mine`
			const created = (await callTool(ownerId, {
				action: 'create_stack',
				agent: 'research',
				scope: 'personal',
				name: personal,
				templates: [],
			})) as StackOutcome
			const personalId = created.outcome === 'created' ? created.stack.id : ''

			// WHEN a run names the personal stack, and when it names none
			const named = await resolveFor(ownerId, {
				agent: 'research',
				overrideStackId: personalId,
			})
			const none = await resolveFor(ownerId, { agent: 'research' })

			// THEN the prompt comes from the chosen stack and the attributes from the org default
			expect(named.stackId).toBe(personalId)
			expect(named.attributeStackId).toBe(defaultId)
			expect(named.attributes.map(a => a.key)).toEqual(expected)
			expect(none.attributeStackId).toBe(defaultId)
			expect(none.attributes.map(a => a.key)).toEqual(expected)
		})
	})
})
