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

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { TimelineActivityService } from '../../services/timeline-activity'
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
			// Surfaces what the tool said rather than the whole cause, which carries
			// stack frames and SQL and would make any failure read alike.
			Effect.catchCause(cause => Effect.die(new Error(toolMessageOf(cause)))),
		),
	)

const seedCompany = async (suffix: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, $3, 'prospect') RETURNING id`,
		[org.id, `${MARKER}-${suffix}`, `${MARKER} ${suffix}`],
	)
	return r.rows[0]!.id
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

const heldStateOf = async (
	address: string,
): Promise<{
	status: string
	statusReason: string | null
	softBounceCount: number
} | null> => {
	const r = await pool.query<{
		status: string
		status_reason: string | null
		soft_bounce_count: number
	}>(
		`SELECT status, status_reason, soft_bounce_count FROM channels
		 WHERE subject_table = 'companies' AND address = $1`,
		[address],
	)
	const row = r.rows[0]
	return row === undefined
		? null
		: {
				status: row.status,
				statusReason: row.status_reason,
				softBounceCount: row.soft_bounce_count,
			}
}

const statusOf = async (address: string): Promise<string | null> =>
	(await heldStateOf(address))?.status ?? null

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
			// state the send gate lets through — and nothing of the old block is
			// left behind, or the next soft bounce would tip it straight back
			expect(await heldStateOf(address)).toEqual({
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

			// THEN both are freed, which is what the description promises. Free only
			// one and a caller that trusts it goes on writing to an address still
			// held back.
			expect(await statusOf(orders)).toBe('unknown')
			expect(await statusOf(accounts)).toBe('unknown')
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
			expect(await statusOf(address)).toBe('bounced')
		})
	})
})
