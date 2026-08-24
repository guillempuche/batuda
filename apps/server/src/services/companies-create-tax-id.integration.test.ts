// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { enterOrgScope } from '../middleware/org'
import { CompanyService } from './companies'

// The real CompanyService.createMany, run against the live database, for the
// second identity a company is deduped on: its registration number.
//
// The batch-INSERT test beside this one pins the SQL contract by hand. This one
// exercises the service itself, because the number is not something the table
// enforces — a statement can watch for one conflict only, so this key is a lookup
// the service performs, written in the service's own SQL. Getting that lookup
// wrong is invisible until the same company is created twice.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let org: { readonly id: string; readonly name: string; readonly slug: string }
const createdIds: string[] = []

// provideMerge, not provide: the test itself needs the SqlClient too, to open the
// org-scoped transaction the service expects to be running inside.
const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

const createMany = (items: ReadonlyArray<Record<string, unknown>>) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org })(service.createMany(items))
		}).pipe(Effect.orDie),
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const orgs = await pool.query<{ id: string; name: string; slug: string }>(
		`SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1`,
		['taller'],
	)
	const row = orgs.rows[0]
	if (!row) {
		throw new Error(
			"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
		)
	}
	org = row
}, 30_000)

afterAll(async () => {
	for (const id of createdIds) {
		await pool.query(`DELETE FROM companies WHERE id = $1::uuid`, [id])
	}
	await pool.end()
	await runtime.dispose()
})

describe('CompanyService.createMany deduping on the registration number', () => {
	describe('when the same company is offered twice in one call, under different names', () => {
		it('should create it once and say which identity matched', async () => {
			// GIVEN one firm submitted twice: two different trading names, so two
			// different slugs, but the same number written two ways
			const suffix = randomUUID().slice(0, 8)
			const digits = `${Date.now()}`.slice(-8)
			const batch = await createMany([
				{
					name: 'Acme SL',
					slug: `acme-${suffix}`,
					taxId: `B-${digits}`,
				},
				{
					name: 'Acme Logistics SL',
					slug: `acme-logistics-${suffix}`,
					taxId: `b${digits}`,
				},
			])
			createdIds.push(...batch.created.map(company => company.id))

			// THEN only the first landed
			expect(batch.created).toHaveLength(1)
			expect(batch.created[0]?.slug).toBe(`acme-${suffix}`)
			expect(batch.created[0]?.taxId).toBe(`B-${digits}`)

			// AND the second is reported as a repeat inside this very call, by its
			// number rather than its slug — which is the whole point: its slug was new,
			// and it was never on file before this call either
			expect(batch.skipped).toStrictEqual([
				{ slug: `acme-logistics-${suffix}`, matchedOn: 'taxIdInRequest' },
			])
		})
	})

	describe('when a slug is reused inside one call', () => {
		it('should report the slug as what matched', async () => {
			// GIVEN two entries sharing a slug and carrying no number at all
			const suffix = randomUUID().slice(0, 8)
			const batch = await createMany([
				{ name: 'Dup One', slug: `dup-${suffix}` },
				{ name: 'Dup Two', slug: `dup-${suffix}` },
			])
			createdIds.push(...batch.created.map(company => company.id))

			// THEN one landed, and the other is reported as the caller having sent the
			// same slug twice rather than as a company already in the CRM
			expect(batch.created).toHaveLength(1)
			expect(batch.skipped).toStrictEqual([
				{ slug: `dup-${suffix}`, matchedOn: 'slugInRequest' },
			])
		})
	})

	describe('when companies carry no registration number', () => {
		it('should create both — a missing number can never collapse two firms', async () => {
			// GIVEN two genuinely different companies, neither with a number
			const suffix = randomUUID().slice(0, 8)
			const batch = await createMany([
				{ name: 'No Number One', slug: `nn-one-${suffix}` },
				{ name: 'No Number Two', slug: `nn-two-${suffix}` },
			])
			createdIds.push(...batch.created.map(company => company.id))

			// THEN both land and nothing is skipped
			expect(batch.created).toHaveLength(2)
			expect(batch.skipped).toStrictEqual([])
		})
	})

	describe('when the number is only punctuation', () => {
		it('should ignore it and fall back to the slug alone', async () => {
			// GIVEN a value that reduces to nothing identifying
			const suffix = randomUUID().slice(0, 8)
			const batch = await createMany([
				{ name: 'Punct One', slug: `pn-one-${suffix}`, taxId: '--' },
				{ name: 'Punct Two', slug: `pn-two-${suffix}`, taxId: '  /  ' },
			])
			createdIds.push(...batch.created.map(company => company.id))

			// THEN both land: a blank number identifies nobody, so it must not be
			// treated as a match between two unrelated firms
			expect(batch.created).toHaveLength(2)
			expect(batch.skipped).toStrictEqual([])
		})
	})
})

describe('CompanyService.createMany telling a company already on file from one sent twice', () => {
	describe('when a later call repeats a number an earlier call created', () => {
		it('should report it as already on file', async () => {
			// GIVEN a company created and finished with, then offered again under a
			// new name in a separate call — the case the in-call repeat is easy to
			// confuse with, and the one where "already existed" is the truth
			const suffix = randomUUID().slice(0, 8)
			const digits = `${Date.now()}`.slice(-8)
			const first = await createMany([
				{ name: 'Prior SL', slug: `prior-${suffix}`, taxId: `B-${digits}` },
			])
			createdIds.push(...first.created.map(company => company.id))

			const second = await createMany([
				{
					name: 'Prior Trading SL',
					slug: `prior-trading-${suffix}`,
					taxId: `b${digits}`,
				},
			])
			createdIds.push(...second.created.map(company => company.id))

			// THEN nothing new landed, and the report says the number was on file
			// rather than sent twice — the caller's list was fine
			expect(second.created).toHaveLength(0)
			expect(second.skipped).toStrictEqual([
				{ slug: `prior-trading-${suffix}`, matchedOn: 'taxId' },
			])
		})
	})

	describe('when a later call repeats a slug an earlier call created', () => {
		it('should report it as already on file', async () => {
			// GIVEN a slug created in one call and offered again in the next
			const suffix = randomUUID().slice(0, 8)
			const first = await createMany([
				{ name: 'Held One', slug: `held-${suffix}` },
			])
			createdIds.push(...first.created.map(company => company.id))

			const second = await createMany([
				{ name: 'Held Two', slug: `held-${suffix}` },
			])
			createdIds.push(...second.created.map(company => company.id))

			// THEN the slug is reported as one the CRM already held
			expect(second.created).toHaveLength(0)
			expect(second.skipped).toStrictEqual([
				{ slug: `held-${suffix}`, matchedOn: 'slug' },
			])
		})
	})
})
