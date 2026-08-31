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
