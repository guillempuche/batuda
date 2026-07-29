// Exercises the instruction MCP tools end-to-end against a real Postgres:
// template transfer (ownership handoff), driven through the real toolkit handlers
// the way a `tools/call` would, inside the same org RLS scope (`enterOrgScope`)
// the /mcp middleware applies. Asserts both the discriminated `{ outcome }` bodies
// and the resulting DB state. Uses the seeded `taller` org: its `owner` exercises
// the admin gate on org stacks, and its plain `member` is both the transfer
// target and the proof that templates are open to everyone. Requires
// $DATABASE_URL.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { Tool } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SessionContext } from '@batuda/controllers'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import type {
	CreateOutcome,
	TransferOutcome,
} from '../../services/instructions'
import { InstructionsService } from '../../services/instructions'
import { applyTestEnv } from '../../test-env'
import {
	InstructionsMcpHandlersLive,
	InstructionsMcpTools,
} from './instructions-mcp'

// Config has no defaults; set the required env before any layer reads it.
applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
// Namespaces every row this suite creates so cleanup never touches seed data.
const MARKER = `mcp-verify-${randomUUID()}-`

type Org = { id: string; name: string; slug: string }
type Tools = typeof InstructionsMcpTools.tools

// The handlers are provided per call against the transaction-scoped SqlClient
// `enterOrgScope` opens, so the service's queries see the request's role + GUCs
// exactly as they do behind the live /mcp middleware.
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
	// Stacks first (CASCADE drops their items, which RESTRICT-reference the
	// templates deleted next).
	await pool.query('DELETE FROM instruction_stacks WHERE name LIKE $1', [
		`${MARKER}%`,
	])
	await pool.query('DELETE FROM instruction_templates WHERE name LIKE $1', [
		`${MARKER}%`,
	])
}

// Invokes a tool the way the MCP server does: validate params, run the handler,
// collect its single result — all inside the actor's org RLS scope.
const callTool = (
	actorId: string,
	name: keyof Tools & string,
	params: Tool.Parameters<Tools[keyof Tools]>,
): Promise<unknown> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: taller, userId: actorId })(
				Effect.gen(function* () {
					const toolkit = yield* InstructionsMcpTools
					const stream = yield* toolkit.handle(name, params)
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
			)
		}),
	)

// Creates a personal template owned by `actorId`, returning its id.
const createPersonalTemplate = async (
	actorId: string,
	label: string,
): Promise<string> => {
	const created = (await callTool(actorId, 'manage_instructions', {
		action: 'create_template',
		name: `${MARKER}${label}`,
		body: 'verification body',
		scope: 'personal',
	})) as CreateOutcome
	if (created.outcome !== 'created')
		throw new Error(`create failed: ${JSON.stringify(created)}`)
	return created.template.id
}

// Creates a personal research stack (and the template it groups) for `actorId`,
// returning the names the tool addresses them by plus the template's id.
const createStackFor = async (
	actorId: string,
	opts: { readonly isDefault?: boolean } = {},
): Promise<{
	readonly stackName: string
	readonly templateName: string
	readonly templateId: string
}> => {
	const label = `st-${randomUUID().slice(0, 8)}`
	const templateId = await createPersonalTemplate(actorId, label)
	const templateName = `${MARKER}${label}`
	const stackName = `${MARKER}s-${randomUUID().slice(0, 8)}`
	const created = (await callTool(actorId, 'manage_instructions', {
		action: 'create_stack',
		agent: 'research',
		scope: 'personal',
		name: stackName,
		templates: [templateName],
		...(opts.isDefault === true ? { is_default: true } : {}),
	})) as { outcome: string }
	if (created.outcome !== 'created')
		throw new Error(`stack create failed: ${JSON.stringify(created)}`)
	return { stackName, templateName, templateId }
}

// The is_default flag of every stack this suite created for `actorId`, keyed by
// name — read straight from the table so the assertions see stored state.
const defaultFlags = async (actorId: string): Promise<Map<string, boolean>> => {
	const rows = await pool.query<{ name: string; is_default: boolean }>(
		`SELECT name, is_default FROM instruction_stacks
		 WHERE owner_user_id = $1 AND name LIKE $2`,
		[actorId, `${MARKER}%`],
	)
	return new Map(rows.rows.map(r => [r.name, r.is_default]))
}

// Calls the privileged transfer function directly in the actor's app_user scope,
// bypassing the service's own checks, to prove the function re-enforces them.
const callTransferFn = (
	actorId: string,
	templateId: string,
	targetUserId: string,
): Promise<ReadonlyArray<{ owner_user_id: string | null }>> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: taller, userId: actorId })(
				sql<{ owner_user_id: string | null }>`
					SELECT owner_user_id
					FROM transfer_instruction_template(${templateId}, ${targetUserId})
				`,
			)
		}),
	)

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

describe('MCP instruction tools against live Postgres', () => {
	describe('when a member transfers a personal template', () => {
		it('should flip ownership to the target member', async () => {
			// GIVEN the member owns a personal template
			const id = await createPersonalTemplate(memberId, 'transfer')

			// WHEN the member transfers it to the owner
			const moved = (await callTool(memberId, 'manage_instructions', {
				action: 'transfer_template',
				id,
				target_user_id: ownerId,
			})) as TransferOutcome

			// THEN the outcome is transferred and the row's owner flips
			// [instructions-mcp.ts transfer_template]
			expect(moved.outcome).toBe('transferred')
			const row = await pool.query<{ owner_user_id: string }>(
				'SELECT owner_user_id FROM instruction_templates WHERE id = $1',
				[id],
			)
			expect(row.rows[0]?.owner_user_id).toBe(ownerId)
		})

		it('should reject a transfer that omits the target', async () => {
			// GIVEN a personal template
			const id = await createPersonalTemplate(memberId, 'transfer-bad')

			// WHEN transfer is called without target_user_id
			const res = await callTool(memberId, 'manage_instructions', {
				action: 'transfer_template',
				id,
			})

			// THEN the handler reports the missing parameter, untouched
			// [instructions-mcp.ts transfer_template guard]
			expect(res).toMatchObject({
				error: expect.stringContaining('target_user_id'),
			})
		})

		it('should refuse to transfer a template still used in a stack', async () => {
			// GIVEN a template the member has put in one of their own stacks —
			// handing it away would make it vanish from that stack at resolution
			const label = `xfer-inuse-${randomUUID().slice(0, 8)}`
			const templateName = `${MARKER}${label}`
			const templateId = await createPersonalTemplate(memberId, label)
			const created = (await callTool(memberId, 'manage_instructions', {
				action: 'create_stack',
				agent: 'research',
				scope: 'personal',
				name: `${MARKER}s-${randomUUID().slice(0, 8)}`,
				templates: [templateName],
			})) as { outcome: string }
			expect(created.outcome).toBe('created')

			// WHEN the member tries to transfer it to the owner
			const moved = (await callTool(memberId, 'manage_instructions', {
				action: 'transfer_template',
				id: templateId,
				target_user_id: ownerId,
			})) as { outcome: string }

			// THEN it is refused as in_use and ownership is untouched
			expect(moved.outcome).toBe('in_use')
			const row = await pool.query<{ owner_user_id: string }>(
				'SELECT owner_user_id FROM instruction_templates WHERE id = $1',
				[templateId],
			)
			expect(row.rows[0]?.owner_user_id).toBe(memberId)
		})
	})

	describe('when an agent lists instruction templates', () => {
		it('should wrap the rows in an items object, never a bare array', async () => {
			// GIVEN the member owns at least one template
			const id = await createPersonalTemplate(memberId, 'list-shape')

			// WHEN the agent lists templates
			// [instructions-mcp.ts list_templates]
			const res = await callTool(memberId, 'manage_instructions', {
				action: 'list_templates',
			})

			// THEN the result is an object under `items`, not a bare array — a bare
			// array is not valid MCP structured output and strict clients reject it
			expect(Array.isArray(res)).toBe(false)
			expect(res).toMatchObject({ items: expect.any(Array) })
			const { items } = res as { items: ReadonlyArray<{ id: string }> }
			expect(items.some(t => t.id === id)).toBe(true)
		})
	})

	describe('when a member manages named stacks through one tool', () => {
		it('should create a stack from a template name, list it, and make it default', async () => {
			// GIVEN the member owns a template to put in a stack
			const label = `stack-${randomUUID().slice(0, 8)}`
			const templateName = `${MARKER}${label}`
			await createPersonalTemplate(memberId, label)

			// WHEN they create a personal research stack referencing it by name
			const stackName = `${MARKER}s-${randomUUID().slice(0, 8)}`
			const created = (await callTool(memberId, 'manage_instructions', {
				action: 'create_stack',
				agent: 'research',
				scope: 'personal',
				name: stackName,
				templates: [templateName],
				is_default: true,
			})) as { outcome: string; stack: { id: string; name: string } }
			expect(created.outcome).toBe('created')

			// THEN it shows up in list_stacks and is the resolved default
			const listed = (await callTool(memberId, 'manage_instructions', {
				action: 'list_stacks',
				agent: 'research',
			})) as { items: ReadonlyArray<{ id: string; name: string }> }
			expect(listed.items.some(s => s.id === created.stack.id)).toBe(true)

			// AND get_stack resolves it by name for the research agent
			const fetched = (await callTool(memberId, 'manage_instructions', {
				action: 'get_stack',
				agent: 'research',
				stack: stackName,
			})) as { id: string }
			expect(fetched.id).toBe(created.stack.id)
		})

		it('should return a clarification for an unknown stack name instead of acting', async () => {
			// WHEN the member references a stack that does not exist
			const res = (await callTool(memberId, 'manage_instructions', {
				action: 'get_stack',
				agent: 'research',
				stack: `${MARKER}nope-${randomUUID().slice(0, 8)}`,
			})) as { _tag?: string; unknown?: ReadonlyArray<string> }

			// THEN it comes back as an instruction_clarification, nothing resolved
			expect(res._tag).toBe('instruction_clarification')
			expect(res.unknown?.length).toBe(1)
		})

		it('should rename a stack and replace its templates', async () => {
			// GIVEN a personal stack with one template
			const { stackName, templateName } = await createStackFor(memberId)
			const renamed = `${MARKER}r-${randomUUID().slice(0, 8)}`

			// WHEN the member renames it and re-lists the same template
			const updated = (await callTool(memberId, 'manage_instructions', {
				action: 'update_stack',
				agent: 'research',
				stack: stackName,
				name: renamed,
				templates: [templateName],
			})) as { outcome: string; stack: { name: string } }

			// THEN the new name is stored and the old one no longer resolves
			expect(updated.outcome).toBe('updated')
			expect(updated.stack.name).toBe(renamed)
			const gone = (await callTool(memberId, 'manage_instructions', {
				action: 'get_stack',
				agent: 'research',
				stack: stackName,
			})) as { _tag?: string }
			expect(gone._tag).toBe('instruction_clarification')
		})

		it('should refuse a blank stack name rather than failing on the database check', async () => {
			// WHEN a stack is created with a name of only spaces
			const res = await callTool(memberId, 'manage_instructions', {
				action: 'create_stack',
				agent: 'research',
				name: '   ',
			})

			// THEN the caller gets an actionable message, not an internal error
			expect(res).toMatchObject({ error: expect.stringContaining('blank') })
		})

		it('should move the default flag between stacks and clear it on request', async () => {
			// GIVEN two personal stacks, the first of them the default
			const first = await createStackFor(memberId, { isDefault: true })
			const second = await createStackFor(memberId)

			// WHEN the second is promoted
			const promoted = (await callTool(memberId, 'manage_instructions', {
				action: 'set_default_stack',
				agent: 'research',
				stack: second.stackName,
			})) as { outcome: string }
			expect(promoted.outcome).toBe('set')

			// THEN exactly the second one carries the flag
			const flags = await defaultFlags(memberId)
			expect(flags.get(second.stackName)).toBe(true)
			expect(flags.get(first.stackName)).toBe(false)

			// AND clearing leaves both stacks in place with no default
			const cleared = (await callTool(memberId, 'manage_instructions', {
				action: 'clear_default_stack',
				agent: 'research',
			})) as { outcome: string }
			expect(cleared.outcome).toBe('cleared')
			const afterClear = await defaultFlags(memberId)
			expect(afterClear.get(second.stackName)).toBe(false)
			expect(afterClear.size).toBe(flags.size)
		})

		it('should delete a stack without touching the templates it grouped', async () => {
			// GIVEN a personal stack built from a template
			const { stackName, templateId } = await createStackFor(memberId)

			// WHEN the stack is deleted
			const deleted = (await callTool(memberId, 'manage_instructions', {
				action: 'delete_stack',
				agent: 'research',
				stack: stackName,
			})) as { outcome: string }

			// THEN the stack is gone and the template it referenced survives
			expect(deleted.outcome).toBe('deleted')
			const template = await pool.query<{ id: string }>(
				'SELECT id FROM instruction_templates WHERE id = $1',
				[templateId],
			)
			expect(template.rows).toHaveLength(1)
		})

		it('should let a plain member create, edit and delete an org template', async () => {
			// GIVEN an org template a plain member creates for the whole org
			const name = `${MARKER}memberorgtpl-${randomUUID().slice(0, 8)}`
			const created = (await callTool(memberId, 'manage_instructions', {
				action: 'create_template',
				name,
				body: 'first body',
				scope: 'org',
			})) as CreateOutcome
			expect(created.outcome).toBe('created')
			if (created.outcome !== 'created') return
			const templateId = created.template.id
			// AND it belongs to the organization, not to the member who wrote it
			expect(created.template.ownerUserId).toBeNull()

			// WHEN the same member rewrites it
			const edited = (await callTool(memberId, 'manage_instructions', {
				action: 'update_template',
				id: templateId,
				body: 'second body',
			})) as { outcome: string }

			// THEN the shared row itself changed — no personal copy was made
			expect(edited.outcome).toBe('updated')
			const rows = await pool.query<{ body: string; owner: string | null }>(
				'SELECT body, owner_user_id AS owner FROM instruction_templates WHERE id = $1',
				[templateId],
			)
			expect(rows.rows[0]?.body).toBe('second body')
			expect(rows.rows[0]?.owner).toBeNull()
			const copies = await pool.query<{ id: string }>(
				'SELECT id FROM instruction_templates WHERE name = $1',
				[name],
			)
			expect(copies.rows).toHaveLength(1)

			// AND the member can delete the org template as well
			const removed = (await callTool(memberId, 'manage_instructions', {
				action: 'delete_template',
				id: templateId,
			})) as { outcome: string }
			expect(removed.outcome).toBe('deleted')
			const gone = await pool.query<{ id: string }>(
				'SELECT id FROM instruction_templates WHERE id = $1',
				[templateId],
			)
			expect(gone.rows).toHaveLength(0)
		})

		it('should forbid a plain member from changing an org stack', async () => {
			// GIVEN an org stack the admin created from an org template
			const orgTemplate = `${MARKER}orgtpl-${randomUUID().slice(0, 8)}`
			const created = (await callTool(ownerId, 'manage_instructions', {
				action: 'create_template',
				name: orgTemplate,
				body: 'org body',
				scope: 'org',
			})) as CreateOutcome
			if (created.outcome !== 'created')
				throw new Error(`org template create failed: ${created.outcome}`)
			const orgStack = `${MARKER}orgstack-${randomUUID().slice(0, 8)}`
			const stack = (await callTool(ownerId, 'manage_instructions', {
				action: 'create_stack',
				agent: 'research',
				scope: 'org',
				name: orgStack,
				templates: [orgTemplate],
			})) as { outcome: string }
			expect(stack.outcome).toBe('created')

			// WHEN the plain member tries to rename it and to delete it
			const renamed = (await callTool(memberId, 'manage_instructions', {
				action: 'update_stack',
				agent: 'research',
				stack: orgStack,
				name: `${MARKER}hijack`,
			})) as { outcome: string }
			const removed = (await callTool(memberId, 'manage_instructions', {
				action: 'delete_stack',
				agent: 'research',
				stack: orgStack,
			})) as { outcome: string }

			// THEN both are refused and the org stack is untouched
			expect(renamed.outcome).toBe('forbidden')
			expect(removed.outcome).toBe('forbidden')
			const row = await pool.query<{ name: string }>(
				'SELECT name FROM instruction_stacks WHERE name = $1',
				[orgStack],
			)
			expect(row.rows).toHaveLength(1)
		})
	})

	// The transfer function self-elevates (BYPASSRLS), so it re-checks the rules
	// the service checks above. These call it directly, past the service, to prove
	// the elevation can't be abused even if a caller's checks were wrong.
	describe('when the transfer function is called past the service checks', () => {
		it('should refuse to move a template the caller does not own', async () => {
			// GIVEN a template owned by the admin
			const adminTemplate = await createPersonalTemplate(ownerId, 'fn-owned')

			// WHEN the plain member invokes the function for it directly
			const rows = await callTransferFn(memberId, adminTemplate, memberId)

			// THEN the in-DB ownership guard yields no row and the owner is untouched
			// [0014_instruction_template_transfer_fn.ts — owner_user_id = v_actor guard]
			expect(rows).toHaveLength(0)
			const check = await pool.query<{ owner_user_id: string }>(
				'SELECT owner_user_id FROM instruction_templates WHERE id = $1',
				[adminTemplate],
			)
			expect(check.rows[0]?.owner_user_id).toBe(ownerId)
		})

		it('should reject a target who is not a member of the org', async () => {
			// GIVEN a template the member owns
			const id = await createPersonalTemplate(memberId, 'fn-nonmember')

			// WHEN the function is called with a non-member target
			const attempt = callTransferFn(memberId, id, 'not-a-member-user-id')

			// THEN the in-DB membership guard raises rather than transferring
			// [0014_instruction_template_transfer_fn.ts — membership EXISTS guard]
			await expect(attempt).rejects.toThrow()
		})
	})
})
