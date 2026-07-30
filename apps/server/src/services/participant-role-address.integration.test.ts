// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import {
	CreatedContact,
	MatchedCompanyOnly,
	ParticipantMatcher,
} from '@batuda/email/participant-matcher'

import { PgLive } from '../db/client'

// What happens when a meeting invite carries a shared mailbox as an attendee.
//
// The calendar path asks the matcher to create a person it does not already
// hold. For `dolors@…` that is right. For `info@…` it was not: it produced a
// contact literally named after the address — somebody who does not exist, who
// could then be assigned a task or greeted by name in a template. The address is
// still worth keeping, so it now goes on the company instead.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `role-addr-${randomUUID()}`
let companyId: string
const DOMAIN = `tallerpuig-${randomUUID().slice(0, 8)}.example`

const runtime = ManagedRuntime.make(
	ParticipantMatcher.layer.pipe(Layer.provideMerge(PgLive)),
)

const match = (email: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const matcher = yield* ParticipantMatcher
			return yield* matcher.match({ email, createPolicy: 'contact-only' })
		}).pipe(
			Effect.provideService(CurrentOrg, {
				id: ORG,
				name: 'Role Address Org',
				slug: ORG,
			}),
		),
	)

const contactsNamed = (name: string) =>
	pool.query(
		`SELECT id FROM contacts WHERE organization_id = $1 AND name = $2`,
		[ORG, name],
	)

const companyChannels = () =>
	pool.query<{ address: string }>(
		`SELECT address FROM channels
		 WHERE organization_id = $1 AND subject_table = 'companies' AND subject_id = $2`,
		[ORG, companyId],
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// The matcher finds the company by the sender's domain, so the company has to
	// carry a website on that domain for any of this to reach the branch.
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Taller Puig') RETURNING id`,
		[ORG, `taller-${randomUUID()}`],
	)
	companyId = company.rows[0]!.id
	// The website is what ties the sender's domain to this company, and it is a
	// channel rather than a column.
	await pool.query(
		`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, is_primary)
		 VALUES ($1, 'companies', $2, 'website', $3, true)`,
		[ORG, companyId, `https://${DOMAIN}`],
	)
}, 30_000)

afterAll(async () => {
	for (const table of ['channels', 'contacts', 'companies']) {
		await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
	}
	await pool.end()
	await runtime.dispose()
})

describe('matching a meeting attendee under a known company domain', () => {
	describe('when the attendee is a shared mailbox', () => {
		it('should attach the address to the company and invent no person', async () => {
			// GIVEN an invite from the company's general mailbox
			const address = `info@${DOMAIN}`

			// WHEN the attendee is resolved with permission to create a person
			const result = await match(address)

			// THEN the company is recognised and no person is made up
			expect(result).toBeInstanceOf(MatchedCompanyOnly)
			expect((await contactsNamed(address)).rows).toHaveLength(0)

			// AND the address is kept where it belongs, so the next reply finds it
			// and the send gate can refuse it if it ever bounces
			expect((await companyChannels()).rows.map(r => r.address)).toContain(
				address,
			)
		})

		it('should not stack a second row when the same mailbox writes again', async () => {
			// GIVEN the same mailbox on a second invite
			await match(`info@${DOMAIN}`)

			// THEN it is still held once
			const rows = (await companyChannels()).rows.filter(
				r => r.address === `info@${DOMAIN}`,
			)
			expect(rows).toHaveLength(1)
		})
	})

	describe('when the attendee is a person', () => {
		it('should still create them, which is what the calendar path is for', async () => {
			// GIVEN a named person at the same company
			const address = `dolors@${DOMAIN}`

			// WHEN resolved
			const result = await match(address)

			// THEN a contact is created as before — the change is about shared
			// mailboxes only, not about creating fewer people
			expect(result).toBeInstanceOf(CreatedContact)
			expect((await contactsNamed(address)).rows).toHaveLength(1)
		})
	})
})
