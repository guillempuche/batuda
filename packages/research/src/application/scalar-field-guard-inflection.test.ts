import { describe, expect, it } from 'vitest'

import { guardScalarFields, titleAsPageWrites } from './scalar-field-guard'

describe('titleAsPageWrites, when a title is one the page joins or inflects', () => {
	it('should keep a hyphenated or slashed title whole', () => {
		// GIVEN titles the page writes with a hyphen and a slash
		const cases = [
			[
				'Jean Dupont, Président-directeur général de la société',
				'Président-directeur général',
			],
			['Gerente/Propietario de la empresa', 'Gerente/Propietario'],
		] as const

		for (const [quote, value] of cases) {
			// WHEN read against the quote
			// THEN the title comes back as written, joiners and all
			expect(titleAsPageWrites(quote, value), value).toBe(value)
		}
	})

	it('should not swap a word for a longer one that merely starts alike', () => {
		// GIVEN a title whose stem the quote shares with a different word
		const cases = [
			['responsable de la direccion comercial', 'Director comercial'],
			['miembro del directorio de Acme', 'Directora'],
		] as const

		for (const [quote, value] of cases) {
			// WHEN read against the quote
			// THEN the model's word stands rather than the page's unrelated one
			expect(titleAsPageWrites(quote, value), value).toBe(value)
		}
	})

	it('should put an ending back to the page’s only matching word', () => {
		// GIVEN the feminine form against a page that writes the masculine
		// WHEN read against the quote
		// THEN the page's word replaces it and the rest stays
		expect(
			titleAsPageWrites(
				'Ana Puig, director general de Acme',
				'Directora general',
			),
		).toBe('director general')
	})
})

describe('guardScalarFields, when a title’s quote is one short word', () => {
	it('should keep the title when the page says that word', () => {
		// GIVEN a role quoted as nothing more than "CEO", which the page says
		const findings = {
			contacts: [
				{
					name: 'Ana Puig',
					role: { value: 'CEO', source_id: 'https://acme.es', quote: 'CEO' },
				},
			],
		}

		// WHEN grounded against the page
		const result = guardScalarFields(findings, 'ana puig, ceo of acme')

		// THEN the title stands
		expect(
			(result.findings as { contacts: Array<{ role: unknown }> }).contacts[0]
				?.role,
		).toEqual({ value: 'CEO', source_id: 'https://acme.es', quote: 'CEO' })
		expect(result.droppedQuoteAbsent).toBe(0)
	})

	it('should drop the title when the word only hides inside other words', () => {
		// GIVEN a role quoted as "DG" against a page where those letters sit
		// across a word join and nowhere on their own
		const findings = {
			contacts: [
				{
					name: 'Ana Puig',
					role: { value: 'DG', source_id: 'https://acme.es', quote: 'DG' },
				},
			],
		}

		// WHEN grounded against the page
		const result = guardScalarFields(findings, 'una ciudad grande de acme')

		// THEN the title goes as absent from the page
		expect(result.droppedQuoteAbsent).toBe(1)
	})
})
