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

// The real CompanyService.createWithContacts, run against the live database.
//
// This is what the one-click handoff from a company search calls, and the two
// things it has to get right are both invisible to a type check: that offering
// the same company a second time lands on the one already here rather than
// making another, and that the people arriving with it are written once.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let org: { readonly id: string; readonly name: string; readonly slug: string }
const createdIds: string[] = []

const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

const takeOn = (
	company: Record<string, unknown>,
	contacts: ReadonlyArray<{ readonly name: string; readonly role?: string }>,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org })(
				service.createWithContacts({ company, contacts }),
			)
		}).pipe(Effect.orDie),
	)

const peopleOn = async (companyId: string) => {
	const rows = await pool.query<{ name: string; role: string | null }>(
		`SELECT name, role FROM contacts WHERE company_id = $1::uuid AND deleted_at IS NULL ORDER BY name`,
		[companyId],
	)
	return rows.rows
}

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
		await pool.query(`DELETE FROM contacts WHERE company_id = $1::uuid`, [id])
		await pool.query(`DELETE FROM companies WHERE id = $1::uuid`, [id])
	}
	await pool.end()
	await runtime.dispose()
})

describe('CompanyService.createWithContacts', () => {
	describe('when a company arrives with the people its pages named', () => {
		it('should write both, leaving the part they play in a purchase unsaid', async () => {
			// GIVEN a company nobody has filed yet, with two people read off its
			// own team page — one with a title, one without
			const slug = `egein-${randomUUID().slice(0, 8)}`
			const result = await takeOn({ name: 'Egein', slug }, [
				{ name: 'David Garrido', role: 'CEO - Enginyer Industrial' },
				{ name: 'Mariona Garrido' },
			])
			createdIds.push(result.company.id)

			// THEN the company lands with both people
			expect(result.created).toBe(true)
			expect(result.contactsAdded).toBe(2)
			const people = await peopleOn(result.company.id)
			expect(people).toStrictEqual([
				{ name: 'David Garrido', role: 'CEO - Enginyer Industrial' },
				{ name: 'Mariona Garrido', role: null },
			])

			// AND nobody is given a part in the buying decision: a search reads a
			// job title off a page and cannot know who holds the budget
			const roles = await pool.query<{ buying_role: string | null }>(
				`SELECT buying_role FROM contacts WHERE company_id = $1::uuid`,
				[result.company.id],
			)
			expect(roles.rows.every(person => person.buying_role === null)).toBe(true)
		})

		it('should store a blank job title as no job title', async () => {
			// GIVEN a person whose title the caller sent as an empty box rather
			// than leaving the field out
			const slug = `blanc-${randomUUID().slice(0, 8)}`
			const result = await takeOn({ name: 'Blanc', slug }, [
				{ name: 'Joan Blanc', role: '' },
				{ name: 'Pau Espai', role: '   ' },
			])
			createdIds.push(result.company.id)

			// THEN both read as having no title. A blank one passes every check
			// for having a title, so it would be quoted back at somebody on a call
			expect(await peopleOn(result.company.id)).toStrictEqual([
				{ name: 'Joan Blanc', role: null },
				{ name: 'Pau Espai', role: null },
			])
		})
	})

	describe('when the same prospect is added a second time', () => {
		it('should land on the company already here rather than make another', async () => {
			// GIVEN a company already filed from a first click
			const slug = `serxar-${randomUUID().slice(0, 8)}`
			const first = await takeOn({ name: 'Serxar', slug }, [
				{ name: 'Gerard Batlle', role: 'Adjunt Direccio' },
			])
			createdIds.push(first.company.id)

			// WHEN the same row is clicked again — which is ordinary, a person
			// working down a list of fifty loses their place
			const second = await takeOn({ name: 'Serxar', slug }, [
				{ name: 'Gerard Batlle', role: 'Adjunt Direccio' },
			])

			// THEN it is the same company, said plainly, and no second row exists
			expect(second.created).toBe(false)
			expect(second.company.id).toBe(first.company.id)
			const rows = await pool.query(
				`SELECT id FROM companies WHERE organization_id = $1 AND slug = $2 AND deleted_at IS NULL`,
				[org.id, slug],
			)
			expect(rows.rowCount).toBe(1)

			// AND the person is not written twice
			expect(second.contactsAdded).toBe(0)
			expect(await peopleOn(first.company.id)).toHaveLength(1)
		})
	})

	describe('when the second click brings somebody the first did not', () => {
		it('should add only the new person', async () => {
			// GIVEN a company filed with one person
			const slug = `bellmas-${randomUUID().slice(0, 8)}`
			const first = await takeOn({ name: 'Bellmas', slug }, [
				{ name: 'Laura Bellmas' },
			])
			createdIds.push(first.company.id)

			// WHEN a later run names a second person alongside the first
			const second = await takeOn({ name: 'Bellmas', slug }, [
				{ name: 'Laura Bellmas' },
				{ name: 'Marc Puig', role: 'Gerent' },
			])

			// THEN only the newcomer is written
			expect(second.contactsAdded).toBe(1)
			expect((await peopleOn(first.company.id)).map(p => p.name)).toStrictEqual(
				['Laura Bellmas', 'Marc Puig'],
			)
		})
	})

	describe('when a person is written with an accent one time and without it the next', () => {
		it('should treat them as one person', async () => {
			// GIVEN a company whose director was filed without her accents
			const slug = `girona-${randomUUID().slice(0, 8)}`
			const first = await takeOn({ name: 'Girona Tec', slug }, [
				{ name: 'Merce Sola' },
			])
			createdIds.push(first.company.id)

			// WHEN a later run spells her properly
			const second = await takeOn({ name: 'Girona Tec', slug }, [
				{ name: 'Mercè Solà' },
			])

			// THEN she is not filed twice: the same person spelled two ways is one
			// person, and two rows would be two people to call
			expect(second.contactsAdded).toBe(0)
			expect(await peopleOn(first.company.id)).toHaveLength(1)
		})
	})

	describe('when the same firm arrives under a different trading name', () => {
		it('should recognise it by the number it is registered under', async () => {
			// GIVEN a company filed with its registration number
			const digits = `${Date.now()}`.slice(-8)
			const first = await takeOn(
				{
					name: 'Especialidades Geotecnicas SL',
					slug: `especialidades-${randomUUID().slice(0, 8)}`,
					taxId: `B-${digits}`,
				},
				[],
			)
			createdIds.push(first.company.id)

			// WHEN the same firm turns up under the name it trades as, which gives
			// a different web address entirely
			const second = await takeOn(
				{
					name: 'Egein Group',
					slug: `egein-group-${randomUUID().slice(0, 8)}`,
					taxId: `b${digits}`,
				},
				[{ name: 'David Garrido', role: 'CEO' }],
			)

			// THEN it is the company already here: the name and the web address
			// both changed, the registration did not
			expect(second.created).toBe(false)
			expect(second.company.id).toBe(first.company.id)

			// AND its people land on the company that was already filed
			expect(second.contactsAdded).toBe(1)
			expect((await peopleOn(first.company.id)).map(p => p.name)).toStrictEqual(
				['David Garrido'],
			)
		})
	})

	describe('when the two identities point at different companies', () => {
		it('should answer with the one the number names, not the name', async () => {
			// GIVEN two companies already on file: one whose registration number
			// this prospect carries, and a different one that happens to reduce to
			// the same web address the prospect's name would
			const digits = `${Date.now()}`.slice(-8)
			const sharedSlug = `talleres-garcia-${randomUUID().slice(0, 8)}`
			const byNumber = await takeOn(
				{
					name: 'Egein SL',
					slug: `egein-sl-${randomUUID().slice(0, 8)}`,
					taxId: `B-${digits}`,
				},
				[],
			)
			createdIds.push(byNumber.company.id)
			const byName = await takeOn(
				{ name: 'Talleres Garcia', slug: sharedSlug },
				[],
			)
			createdIds.push(byName.company.id)

			// WHEN a prospect arrives carrying the first one's number and the
			// second one's address
			const result = await takeOn(
				{ name: 'Talleres Garcia', slug: sharedSlug, taxId: `b${digits}` },
				[],
			)

			// THEN the number decides. A name is written differently every time and
			// two unrelated firms can reduce to one address; a registration cannot.
			expect(result.created).toBe(false)
			expect(result.company.id).toBe(byNumber.company.id)
		})
	})

	describe('when a different firm reduces to the same address', () => {
		it('should keep them apart rather than file one under the other', async () => {
			// GIVEN a company on file under a registration number of its own
			const slug = `talleres-garcia-${randomUUID().slice(0, 8)}`
			const digits = `${Date.now()}`.slice(-8)
			const first = await takeOn(
				{ name: 'Talleres Garcia', slug, taxId: `B-${digits}` },
				[{ name: 'Joan Garcia', role: 'Gerent' }],
			)
			createdIds.push(first.company.id)

			// WHEN a genuinely different firm arrives whose name folds to the same
			// address — accents dropped, long names cut short — carrying its own
			// and different number
			const second = await takeOn(
				{ name: 'Talleres García', slug, taxId: `B-${Number(digits) + 1}` },
				[{ name: 'Marta Puig', role: 'Directora' }],
			)
			createdIds.push(second.company.id)

			// THEN it is its own company, not the first one wearing a second set of
			// people: two numbers mean two firms, whatever the address says
			expect(second.created).toBe(true)
			expect(second.company.id).not.toBe(first.company.id)

			// AND neither one has been given the other's people
			expect((await peopleOn(first.company.id)).map(p => p.name)).toStrictEqual(
				['Joan Garcia'],
			)
			expect(
				(await peopleOn(second.company.id)).map(p => p.name),
			).toStrictEqual(['Marta Puig'])
		})

		it('should still answer to its own number when offered again', async () => {
			// GIVEN the firm that had to take an address of its own
			const slug = `metalls-${randomUUID().slice(0, 8)}`
			const digits = `${Date.now()}`.slice(-7)
			const holder = await takeOn(
				{ name: 'Metalls', slug, taxId: `A-${digits}` },
				[],
			)
			createdIds.push(holder.company.id)
			const other = await takeOn(
				{ name: 'Metalls', slug, taxId: `A-${Number(digits) + 1}` },
				[],
			)
			createdIds.push(other.company.id)

			// WHEN it is offered a third time, address clash and all
			const again = await takeOn(
				{ name: 'Metalls', slug, taxId: `A-${Number(digits) + 1}` },
				[{ name: 'Nou Contacte' }],
			)

			// THEN it lands on itself rather than making a third row: the address
			// still clashes, but the number settles it
			expect(again.created).toBe(false)
			expect(again.company.id).toBe(other.company.id)
			expect(again.contactsAdded).toBe(1)
		})
	})

	describe('when a company already here is offered its registration number', () => {
		it('should write the number down rather than drop it', async () => {
			// GIVEN a company filed from an earlier click, before any run had read
			// its number
			const slug = `enigest-${randomUUID().slice(0, 8)}`
			const first = await takeOn({ name: 'Enigest', slug }, [])
			createdIds.push(first.company.id)
			expect(first.company.taxId).toBeNull()

			// WHEN a later run reads the number off its registry page and the
			// person clicks again
			const digits = `${Date.now()}`.slice(-8)
			const second = await takeOn(
				{ name: 'Enigest', slug, taxId: `B-${digits}` },
				[],
			)

			// THEN it lands on the company, and the number is kept: without it the
			// same firm arriving later under another name would be filed twice
			expect(second.created).toBe(false)
			expect(second.company.id).toBe(first.company.id)
			const held = await pool.query<{ tax_id: string | null }>(
				`SELECT tax_id FROM companies WHERE id = $1::uuid`,
				[first.company.id],
			)
			expect(held.rows[0]?.tax_id).toBe(`B-${digits}`)
		})
	})

	describe('when two firms share an address and neither has a number', () => {
		it('should keep them apart and still recognise each one again', async () => {
			// GIVEN one firm on file, in Girona, with no registration number — which
			// is the ordinary case, since the register is rarely reachable
			const slug = `talleres-vidal-${randomUUID().slice(0, 8)}`
			const girona = await takeOn(
				{ name: 'Talleres Vidal', slug, location: 'Girona' },
				[{ name: 'Joan Vidal' }],
			)
			createdIds.push(girona.company.id)

			// WHEN a different firm of the same name, in Sevilla, is offered
			const sevilla = await takeOn(
				{ name: 'Talleres Vidal', slug, location: 'Sevilla' },
				[{ name: 'Marta Ruiz' }],
			)
			createdIds.push(sevilla.company.id)

			// THEN it is its own company: the place says they are not the same firm,
			// and folding them together would put Sevilla's people on Girona's record
			expect(sevilla.created).toBe(true)
			expect(sevilla.company.id).not.toBe(girona.company.id)

			// AND offering the Sevilla one again lands on itself rather than filing
			// a third — the address it took is its own place, not a fresh guess
			const again = await takeOn(
				{ name: 'Talleres Vidal', slug, location: 'Sevilla' },
				[{ name: 'Marta Ruiz' }, { name: 'Pau Gil' }],
			)
			expect(again.created).toBe(false)
			expect(again.company.id).toBe(sevilla.company.id)
			expect(again.contactsAdded).toBe(1)

			// AND neither company wears the other's people
			expect(
				(await peopleOn(girona.company.id)).map(p => p.name),
			).toStrictEqual(['Joan Vidal'])
			expect(
				(await peopleOn(sevilla.company.id)).map(p => p.name),
			).toStrictEqual(['Marta Ruiz', 'Pau Gil'])
		})
	})

	describe('when a company arrives with nobody', () => {
		it('should file it and report no people', async () => {
			const slug = `quiet-${randomUUID().slice(0, 8)}`
			const result = await takeOn({ name: 'Quiet SL', slug }, [])
			createdIds.push(result.company.id)

			expect(result.created).toBe(true)
			expect(result.contactsAdded).toBe(0)
			expect(await peopleOn(result.company.id)).toHaveLength(0)
		})
	})
})
