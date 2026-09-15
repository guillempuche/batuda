import { describe, expect, it } from 'vitest'

import { settlePairedFields } from './paired-field-shape'

// ── Test helpers ──

const scanWith = (...rows: ReadonlyArray<Record<string, unknown>>) => ({
	prospects: rows,
})

const settle = (findings: unknown) =>
	settlePairedFields(findings, 'prospect_scan_v1', 'prospects')

const rowsOf = (findings: unknown): Array<Record<string, unknown>> =>
	(findings as { prospects: Array<Record<string, unknown>> }).prospects

describe('settlePairedFields, on the attribute map', () => {
	describe('when a scan row carries bare attribute values', () => {
		it('should pair each one and count it, leaving a paired one alone', () => {
			// GIVEN a number, a word, a no and one already paired
			const { findings, wrapped } = settle(
				scanWith({
					name: 'Acme',
					attributes: {
						site_count: 3,
						fit: 'strong',
						takes_bookings: false,
						founded_on: { value: '2020-01-01' },
					},
				}),
			)

			// THEN the three bare ones are paired with no page named
			expect(rowsOf(findings)[0]?.['attributes']).toEqual({
				site_count: { value: 3 },
				fit: { value: 'strong' },
				takes_bookings: { value: false },
				founded_on: { value: '2020-01-01' },
			})
			expect(wrapped).toBe(3)
		})
	})

	describe('when a company profile carries bare attribute values', () => {
		it('should pair them beside the profile, and leave a profile without any as it is', () => {
			// GIVEN a profile with one bare attribute, and one with none
			const profile = {
				enrichment: { industry: { value: 'x' } },
				attributes: { site_count: 3 },
			}
			const plain = { enrichment: { industry: { value: 'x' } } }

			// WHEN settled the way a profile is
			const settled = settlePairedFields(
				profile,
				'company_enrichment_v1',
				undefined,
			)

			// THEN the attribute is paired and the other profile is the same object
			expect(settled.findings).toEqual({
				enrichment: { industry: { value: 'x' } },
				attributes: { site_count: { value: 3 } },
			})
			expect(settled.wrapped).toBe(1)
			expect(
				settlePairedFields(plain, 'company_enrichment_v1', undefined).findings,
			).toBe(plain)
		})
	})
})

describe('settlePairedFields', () => {
	describe('when a field that carries its evidence arrives on its own', () => {
		it('should pair it, keeping the value and naming no page', () => {
			// GIVEN a company whose location came back as plain text — the shape three
			// runs out of four actually stored
			const { findings, wrapped } = settle(
				scanWith({
					name: 'Jumijor Castellbisbal SL',
					location: 'Castellbisbal, Barcelona',
				}),
			)

			// THEN the value is where a reader looks for it
			// AND no page is named, because none was known — inventing one would turn
			// a missing citation into a false one
			expect(rowsOf(findings)[0]?.['location']).toEqual({
				value: 'Castellbisbal, Barcelona',
			})
			expect(wrapped).toBe(1)
		})

		it('should pair the registration number and the trade too', () => {
			// GIVEN a row whose tax id and trade came back as plain text, which is
			// how a model writes them unless the schema asks otherwise
			const { findings } = settle(
				scanWith({
					name: 'ACME',
					tax_id: 'B12345678',
					industry: 'metalworking',
				}),
			)

			// THEN both are paired like the fields beside them. Left out of the list
			// while the schema declares them paired, they would reach storage as a
			// string on one run and an object on the next — the very mixture this
			// settling exists to end.
			expect(rowsOf(findings)[0]?.['tax_id']).toEqual({ value: 'B12345678' })
			expect(rowsOf(findings)[0]?.['industry']).toEqual({
				value: 'metalworking',
			})
		})

		it('should pair a figure written as a bare number too', () => {
			// GIVEN a headcount that reached the row as the number alone
			const { findings } = settle(
				scanWith({ name: 'ACME', employee_estimate: 45 }),
			)

			// THEN it is paired like any other value
			expect(rowsOf(findings)[0]?.['employee_estimate']).toEqual({ value: 45 })
		})
	})

	describe('when a field already carries its page', () => {
		it('should leave it exactly as it is', () => {
			// GIVEN a location already paired with the page it was read on
			const paired = {
				value: 'Rubí, Barcelona',
				source_id: 'src-1',
				quote: 'con sede en Rubí',
			}
			const { findings, wrapped } = settle(
				scanWith({ name: 'X', location: paired }),
			)

			// THEN nothing about it changes, evidence included
			expect(rowsOf(findings)[0]?.['location']).toBe(paired)
			expect(wrapped).toBe(0)
		})
	})

	describe('when a field is absent or empty', () => {
		it('should leave it alone rather than pair an answer nobody gave', () => {
			// GIVEN one company with no location at all, one with null, and one with
			// blank text
			const { findings, wrapped } = settle(
				scanWith(
					{ name: 'no key' },
					{ name: 'explicit null', location: null },
					{ name: 'blank', location: '   ' },
				),
			)

			// THEN none of them gains a location that says nothing
			expect(rowsOf(findings)[0]?.['location']).toBeUndefined()
			expect(rowsOf(findings)[1]?.['location']).toBe(null)
			expect(rowsOf(findings)[2]?.['location']).toBe('   ')
			expect(wrapped).toBe(0)
		})
	})

	describe('when the row carries a field that is not one of these', () => {
		it("should not touch the company's name", () => {
			// GIVEN a name, which is declared as plain text and is not evidence-carrying
			const { findings } = settle(
				scanWith({ name: 'SOPREMA IBERIA S.L.U.', location: 'Castellbisbal' }),
			)

			// THEN the name is still plain text — settling one field does not sweep
			// up its neighbours
			expect(rowsOf(findings)[0]?.['name']).toBe('SOPREMA IBERIA S.L.U.')
		})
	})

	describe('when the findings are not a scan this applies to', () => {
		it('should hand back exactly what it was given', () => {
			// GIVEN a kind of run with no such fields, a missing list, and findings
			// that are not an object at all
			const enrichment = { enrichment: { country: 'ES' } }
			expect(
				settlePairedFields(enrichment, 'company_enrichment_v1', 'enrichment')
					.findings,
			).toBe(enrichment)

			const noList = { prospects: 'not a list' }
			expect(settle(noList).findings).toBe(noList)

			expect(
				settlePairedFields('nope', 'prospect_scan_v1', 'prospects').findings,
			).toBe('nope')
			expect(settle(scanWith()).findings).toEqual({ prospects: [] })
		})
	})

	describe('when several rows and fields need settling', () => {
		it('should count every field it had to put right', () => {
			// GIVEN two companies, one with two bare fields and one with none
			const { wrapped } = settle(
				scanWith(
					{ name: 'A', location: 'Rubí', website: 'https://a.example' },
					{ name: 'B', location: { value: 'Terrassa', source_id: 's' } },
				),
			)

			// THEN the count is of fields, not of rows — it is what tells an operator
			// how often this is still happening
			expect(wrapped).toBe(2)
		})
	})
})
