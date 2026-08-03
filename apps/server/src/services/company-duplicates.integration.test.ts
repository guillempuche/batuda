// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client.js'
import { findDuplicateCompanies } from './company-duplicates'

// What the org's own rows say about a name, against a real database.
//
// The pure scoring is covered next door; what needs a database is the part that
// reads the organisation's companies and their websites, because that is where
// the weighting comes from — a word is only worth something here if few of this
// organisation's companies use it.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const ORG = `dup-org-${randomUUID()}`

const run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<A>,
	)

const seed = (name: string, website?: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`
		const rows = yield* sql<{ id: string }>`
			INSERT INTO companies (organization_id, slug, name)
			VALUES (${ORG}, ${slug}, ${name}) RETURNING id
		`
		const id = rows[0]?.id as string
		if (website !== undefined) {
			yield* sql`
				INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, is_primary)
				VALUES (${ORG}, 'companies', ${id}, 'website', ${website}, true)
			`
		}
		return id
	})

beforeAll(async () => {
	await run(
		Effect.gen(function* () {
			// A freight-shaped organisation: "transports" is how it names things, so
			// the word has to stop counting as evidence.
			yield* seed('Transports Ferré', 'transportsferre.cat')
			yield* seed('Transports Puig')
			yield* seed('Transports Vidal')
			yield* seed('Transports Roca')
			yield* seed('Transports Mas')
			yield* seed('Fusteria Vidal')
		}),
	)
})

afterAll(async () => {
	await run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM channels WHERE organization_id = ${ORG}`
			yield* sql`DELETE FROM companies WHERE organization_id = ${ORG}`
		}),
	)
})

describe('finding a company that is already on file', () => {
	describe('when the new name is the old one with a company form added', () => {
		it('should report it', async () => {
			// GIVEN "Fusteria Vidal" is already there
			const found = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* findDuplicateCompanies(sql, ORG, [
						{ slug: 'fusteria-vidal-sl', name: 'Fusteria Vidal SL' },
					])
				}),
			)
			// THEN the person adding it is told, rather than quietly getting a second row
			expect(found).toHaveLength(1)
			expect(found[0]?.existing_name).toBe('Fusteria Vidal')
			expect(found[0]?.matched_on).toBe('name')
		})
	})

	describe('when two companies share only the word this organisation names everything with', () => {
		it('should not report it', async () => {
			// GIVEN five of six companies are "Transports something", so the word says
			// nothing about which of them this is
			const found = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* findDuplicateCompanies(sql, ORG, [
						{ slug: 'transports-nou', name: 'Transports Nou' },
					])
				}),
			)
			expect(found).toEqual([])
		})
	})

	describe('when the new company gives a website already on file', () => {
		it('should report it whatever it calls itself', async () => {
			const found = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* findDuplicateCompanies(sql, ORG, [
						{
							slug: 'ferre-logistica',
							name: 'Ferré Logística',
							website: 'https://www.transportsferre.cat/contacte',
						},
					])
				}),
			)
			expect(found).toHaveLength(1)
			expect(found[0]?.existing_name).toBe('Transports Ferré')
			expect(found[0]?.matched_on).toBe('website')
		})
	})

	describe('when nothing resembles it', () => {
		it('should report nothing', async () => {
			const found = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* findDuplicateCompanies(sql, ORG, [
						{ slug: 'forn-sant-jordi', name: 'Forn Sant Jordi' },
					])
				}),
			)
			expect(found).toEqual([])
		})
	})
})
