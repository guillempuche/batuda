// Live-DB integration test for letting mail go to a company's own mailboxes
// again, driven through the real toolkit handler the way a `tools/call` would,
// inside the same org RLS scope (`enterOrgScope`) the /mcp middleware applies.
//
// A role address — info@, orders@ — has nobody listed under it, so nothing that
// speaks for a person can lift its block. That is the whole reason this sits on
// `update_company` rather than on a contact.
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
// Namespaces every row this suite creates so cleanup never touches seed data.
const MARKER = `unblock-${randomUUID()}`

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

const toolMessageOf = (cause: Cause.Cause<unknown>): string => {
	const failure = Cause.squash(cause)
	return isToolMessage(failure)
		? failure.message
		: `not a message written for the caller: ${String(failure)}`
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
	email: `${actorId}@unblock.local`,
	name: 'Unblocker',
	isAgent: true,
})

const updateCompany = (params: Record<string, unknown>): Promise<void> =>
	runInOrg(
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			const stream = yield* toolkit.handle('update_company', params as never)
			yield* Stream.runCollect(stream)
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(Handlers),
			// Keeps what the tool said rather than the whole cause, so a failing test
			// names the refusal instead of stack frames and SQL.
			Effect.catchCause(cause => Effect.die(new Error(toolMessageOf(cause)))),
		),
	)

// Hands back the sentence the tool refused with, which is the part a caller
// acts on.
const vouchRefusal = (companyId: string, channelId: string): Promise<string> =>
	runInOrg(
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			const stream = yield* toolkit.handle('manage_company_channels', {
				action: 'vouch',
				company_id: companyId,
				channel_id: channelId,
			} as never)
			yield* Stream.runCollect(stream)
			throw new Error('expected the vouch to be refused, but it was accepted')
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(Handlers),
			Effect.catchCause(cause => Effect.succeed(toolMessageOf(cause))),
		),
	)

const seedCompany = async (suffix: string): Promise<string> => {
	const inserted = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, $3, 'prospect') RETURNING id`,
		[org.id, `${MARKER}-${suffix}`, `${MARKER} ${suffix}`],
	)
	return inserted.rows[0]!.id
}

// A vouch shares a column with a bounce, which is what puts it in reach of a
// call meant only to lift blocks.
const seedVouchedMailbox = async (
	companyId: string,
	address: string,
): Promise<void> => {
	await pool.query(
		`INSERT INTO channels
		   (organization_id, subject_table, subject_id, channel, address, status, status_reason, soft_bounce_count)
		 VALUES ($1, 'companies', $2, 'email', $3, 'valid', 'Confirmed by the office manager', 2)`,
		[org.id, companyId, address],
	)
}

const seedHeldMailbox = async (
	companyId: string,
	address: string,
	status: 'bounced' | 'complained',
): Promise<void> => {
	await pool.query(
		`INSERT INTO channels
		   (organization_id, subject_table, subject_id, channel, address, status, status_reason, soft_bounce_count)
		 VALUES ($1, 'companies', $2, 'email', $3, $4, '550 mailbox unavailable', 3)`,
		[org.id, companyId, address, status],
	)
}

const mailboxStateOf = async (
	companyId: string,
	address: string,
): Promise<{
	status: string
	statusReason: string | null
	softBounceCount: number
} | null> => {
	const found = await pool.query<{
		status: string
		status_reason: string | null
		soft_bounce_count: number
	}>(
		`SELECT status, status_reason, soft_bounce_count FROM channels
		 WHERE subject_table = 'companies' AND subject_id = $1 AND address = $2`,
		[companyId, address],
	)
	const row = found.rows[0]
	return row === undefined
		? null
		: {
				status: row.status,
				statusReason: row.status_reason,
				softBounceCount: row.soft_bounce_count,
			}
}

const statusOf = async (
	companyId: string,
	address: string,
): Promise<string | null> =>
	(await mailboxStateOf(companyId, address))?.status ?? null

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runtime = makeRuntime()

	const orgs = await pool.query<Org>(
		`SELECT id, name, slug FROM organization WHERE slug = 'taller' LIMIT 1`,
	)
	const taller = orgs.rows[0]
	if (!taller) throw new Error("taller org missing — run 'pnpm cli seed'")
	org = taller

	const members = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[org.id],
	)
	const member = members.rows[0]
	if (!member) throw new Error("taller has no members — run 'pnpm cli seed'")
	actorId = member.userId
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM channels WHERE subject_id IN
		 (SELECT id FROM companies WHERE slug LIKE $1)`,
		[`${MARKER}%`],
	)
	await pool.query('DELETE FROM companies WHERE slug LIKE $1', [`${MARKER}%`])
	await runtime.dispose()
	await pool.end()
})

describe('update_company with clear_email_suppression', () => {
	describe('when a company mailbox nobody is listed under is held back', () => {
		it('should let mail go to it again', async () => {
			// GIVEN a role address held back after a hard bounce — no contact holds
			// it, so nothing speaking for a person could lift the block
			const companyId = await seedCompany('single')
			const address = `info@${MARKER}.example`
			await seedHeldMailbox(companyId, address, 'bounced')

			// WHEN an assistant asks for the block to be lifted
			await updateCompany({ id: companyId, clear_email_suppression: true })

			// THEN the address is back to nobody having judged it, which is the
			// state the send gate lets through, and nothing of the old block is left
			// behind for the next soft bounce to count from
			expect(await mailboxStateOf(companyId, address)).toEqual({
				status: 'unknown',
				statusReason: null,
				softBounceCount: 0,
			})
		})
	})

	describe('when the company holds more than one held-back address', () => {
		it('should free every one of them, as the tool says it does', async () => {
			// GIVEN two of the company's own mailboxes held back for different
			// reasons
			const companyId = await seedCompany('several')
			const orders = `orders@${MARKER}.example`
			const accounts = `accounts@${MARKER}.example`
			await seedHeldMailbox(companyId, orders, 'bounced')
			await seedHeldMailbox(companyId, accounts, 'complained')

			// WHEN the block is lifted once
			await updateCompany({ id: companyId, clear_email_suppression: true })

			// THEN both are freed, which is what the tool description promises a
			// caller that goes on to write to either of them
			expect(await statusOf(companyId, orders)).toBe('unknown')
			expect(await statusOf(companyId, accounts)).toBe('unknown')
		})
	})

	describe('when one of the company mailboxes was vouched for, not blocked', () => {
		it('should lift the block and leave the vouch standing', async () => {
			// GIVEN a company holding both: one mailbox held back after a bounce, and
			// another somebody put their name to. Both states live in the same
			// column, which is what makes this worth pinning.
			const companyId = await seedCompany('vouched')
			const blocked = `info-blocked@${MARKER}.example`
			const vouched = `orders-vouched@${MARKER}.example`
			await seedHeldMailbox(companyId, blocked, 'bounced')
			await seedVouchedMailbox(companyId, vouched)

			// WHEN the block is lifted
			await updateCompany({ id: companyId, clear_email_suppression: true })

			// THEN the blocked one is freed and the vouch stands, note and all — a
			// vouch is somebody's word on an address, and only 'unvouch' takes it
			// back. Its soft-bounce tally stands with it, this call reaching only
			// the addresses a block holds back.
			expect(await statusOf(companyId, blocked)).toBe('unknown')
			expect(await mailboxStateOf(companyId, vouched)).toEqual({
				status: 'valid',
				statusReason: 'Confirmed by the office manager',
				softBounceCount: 2,
			})
		})
	})

	describe('when an ordinary edit is made without asking to lift anything', () => {
		it('should leave the block exactly where it was', async () => {
			// GIVEN a held-back mailbox on a company being edited for another reason
			const companyId = await seedCompany('untouched')
			const address = `info-untouched@${MARKER}.example`
			await seedHeldMailbox(companyId, address, 'bounced')

			// WHEN a field unrelated to any of this is changed
			await updateCompany({ id: companyId, industry: 'fusteria' })

			// THEN the block stands. Lifting one is somebody deciding the address
			// works again, never a side effect of editing the company.
			expect(await statusOf(companyId, address)).toBe('bounced')
		})
	})
})

describe('manage_company_channels vouching', () => {
	describe('when somebody vouches for a mailbox a bounce holds back', () => {
		it('should name the way out, not just the refusal', async () => {
			// GIVEN a company mailbox held back after a bounce
			const companyId = await seedCompany('refusal')
			const address = `info-refusal@${MARKER}.example`
			await seedHeldMailbox(companyId, address, 'bounced')
			const heldMailbox = await pool.query<{ id: string }>(
				`SELECT id FROM channels WHERE subject_table = 'companies' AND address = $1`,
				[address],
			)
			const channelId = heldMailbox.rows[0]!.id

			// WHEN somebody tries to vouch for it, which no vouch can lift
			const refusal = await vouchRefusal(companyId, channelId)

			// THEN the refusal names where the way out is, a caller acting on the
			// answer it just got rather than on the tool's description
			expect(refusal).toContain('no vouch lifts')
			expect(refusal).toContain('update_company')
			expect(refusal).toContain('clear_email_suppression')
		})
	})
})
