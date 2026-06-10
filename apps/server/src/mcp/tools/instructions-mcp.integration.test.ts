// Exercises the instruction MCP tools end-to-end against a real Postgres:
// transfer (template ownership) and the donation lifecycle (propose → list →
// accept/reject), driven through the real toolkit handlers the way a `tools/call`
// would, inside the same org RLS scope (`enterOrgScope`) the /mcp middleware
// applies. Asserts both the discriminated `{ outcome }` bodies and the resulting
// DB state. Uses the seeded `taller` org: its `owner` acts as the admin gate, its
// plain `member` as the proposer / transfer target. Requires $DATABASE_URL.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { Tool } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SessionContext } from '@batuda/controllers'
import type { Donation } from '@batuda/instructions'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import type {
	CreateOutcome,
	DonateOutcome,
	ResolveDonationOutcome,
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
	await pool.query(
		'DELETE FROM instruction_template_donations WHERE name LIKE $1',
		[`${MARKER}%`],
	)
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
	const created = (await callTool(actorId, 'manage_instruction_template', {
		action: 'create',
		name: `${MARKER}${label}`,
		body: 'verification body',
		scope: 'personal',
	})) as CreateOutcome
	if (created.outcome !== 'created')
		throw new Error(`create failed: ${JSON.stringify(created)}`)
	return created.template.id
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
			const moved = (await callTool(memberId, 'manage_instruction_template', {
				action: 'transfer',
				id,
				target_user_id: ownerId,
			})) as TransferOutcome

			// THEN the outcome is transferred and the row's owner flips
			// [instructions-mcp.ts manage_instruction_template:transfer]
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
			const res = await callTool(memberId, 'manage_instruction_template', {
				action: 'transfer',
				id,
			})

			// THEN the handler reports the missing parameter, untouched
			// [instructions-mcp.ts manage_instruction_template:transfer guard]
			expect(res).toMatchObject({
				error: expect.stringContaining('target_user_id'),
			})
		})
	})

	describe('when a member donates a template the org reviews', () => {
		it('should let an admin accept it into a fresh org template', async () => {
			// GIVEN the member proposes a personal template to the org
			const templateId = await createPersonalTemplate(memberId, 'donate-accept')
			const proposed = (await callTool(
				memberId,
				'manage_instruction_donation',
				{
					action: 'propose',
					template_id: templateId,
				},
			)) as DonateOutcome
			if (proposed.outcome !== 'proposed')
				throw new Error(`propose failed: ${JSON.stringify(proposed)}`)
			const donationId = proposed.donation.id

			// WHEN the owner lists pending donations
			// [instructions-mcp.ts manage_instruction_donation:list]
			const pending = (await callTool(ownerId, 'manage_instruction_donation', {
				action: 'list',
				status: 'pending',
			})) as ReadonlyArray<Donation>
			expect(pending.some(d => d.id === donationId)).toBe(true)

			// AND the owner accepts it
			const accepted = (await callTool(ownerId, 'manage_instruction_donation', {
				action: 'accept',
				id: donationId,
			})) as ResolveDonationOutcome

			// THEN a fresh org-owned template is created and the donation closes
			// [instructions-mcp.ts manage_instruction_donation:accept]
			if (accepted.outcome !== 'accepted')
				throw new Error(`accept failed: ${JSON.stringify(accepted)}`)
			const orgTemplate = await pool.query<{ owner_user_id: string | null }>(
				'SELECT owner_user_id FROM instruction_templates WHERE id = $1',
				[accepted.template.id],
			)
			expect(orgTemplate.rows[0]?.owner_user_id).toBeNull()
			const donation = await pool.query<{ status: string }>(
				'SELECT status FROM instruction_template_donations WHERE id = $1',
				[donationId],
			)
			expect(donation.rows[0]?.status).toBe('accepted')
		})

		it('should let an admin reject a pending donation', async () => {
			// GIVEN a pending donation
			const templateId = await createPersonalTemplate(memberId, 'donate-reject')
			const proposed = (await callTool(
				memberId,
				'manage_instruction_donation',
				{
					action: 'propose',
					template_id: templateId,
				},
			)) as DonateOutcome
			if (proposed.outcome !== 'proposed')
				throw new Error(`propose failed: ${JSON.stringify(proposed)}`)

			// WHEN the owner rejects it
			const rejected = (await callTool(ownerId, 'manage_instruction_donation', {
				action: 'reject',
				id: proposed.donation.id,
			})) as ResolveDonationOutcome

			// THEN the proposal closes as rejected
			// [instructions-mcp.ts manage_instruction_donation:reject]
			expect(rejected.outcome).toBe('rejected')
			const donation = await pool.query<{ status: string }>(
				'SELECT status FROM instruction_template_donations WHERE id = $1',
				[proposed.donation.id],
			)
			expect(donation.rows[0]?.status).toBe('rejected')
		})

		it('should forbid a non-admin from accepting', async () => {
			// GIVEN a pending donation
			const templateId = await createPersonalTemplate(memberId, 'donate-forbid')
			const proposed = (await callTool(
				memberId,
				'manage_instruction_donation',
				{
					action: 'propose',
					template_id: templateId,
				},
			)) as DonateOutcome
			if (proposed.outcome !== 'proposed')
				throw new Error(`propose failed: ${JSON.stringify(proposed)}`)

			// WHEN the plain member tries to accept it
			const res = (await callTool(memberId, 'manage_instruction_donation', {
				action: 'accept',
				id: proposed.donation.id,
			})) as ResolveDonationOutcome

			// THEN the admin gate forbids it and the donation stays pending
			// [instructions-mcp.ts manage_instruction_donation:accept admin gate]
			expect(res.outcome).toBe('forbidden')
			const donation = await pool.query<{ status: string }>(
				'SELECT status FROM instruction_template_donations WHERE id = $1',
				[proposed.donation.id],
			)
			expect(donation.rows[0]?.status).toBe('pending')
		})

		it('should reject a propose that omits the template', async () => {
			// WHEN propose is called without template_id
			const res = await callTool(memberId, 'manage_instruction_donation', {
				action: 'propose',
			})

			// THEN the handler reports the missing parameter
			// [instructions-mcp.ts manage_instruction_donation:propose guard]
			expect(res).toMatchObject({
				error: expect.stringContaining('template_id'),
			})
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
