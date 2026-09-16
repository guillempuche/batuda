import { describe, expect, it } from 'vitest'

import { guardScalarFields } from './scalar-field-guard'

const person = (role: Record<string, unknown>) => ({
	contacts: [{ name: 'Ana Puig', role }],
})
const roleOf = (findings: unknown): unknown =>
	(findings as { contacts: Array<{ role: unknown }> }).contacts[0]?.role
const at = (quote: string) => ({ source_id: 'https://acme.es', quote })

describe('guardScalarFields, when a title is a label, a headline or a reworded line', () => {
	describe('when the value is the label a page puts beside a name', () => {
		it('should drop it as not a title', () => {
			// GIVEN the labels seen stored as job titles, in three languages
			for (const value of ['Contact', 'contacto', 'Tel', 'Email', 'Web']) {
				// WHEN grounded against a quote that carries the label
				const quote = `${value} Diego Navarro`
				const result = guardScalarFields(
					person({ value, ...at(quote) }),
					`acme. ${quote}`,
				)
				// THEN the title goes, named as a label in the trace
				expect(roleOf(result.findings), value).toBeNull()
				expect(result.droppedNotTitle).toBe(1)
				expect(result.drops[0]?.reason).toBe('not_a_title')
			}
		})
	})

	describe('when the value is a headline of several posts', () => {
		it('should keep the first post and drop one that never ends', () => {
			// GIVEN a LinkedIn headline and a sentence-long value
			const headline =
				'Operation Manager | Plant Manager | Managing Director | Life Science'
			const quote = `Ana Puig. ${headline}`
			const sentence =
				'the person in charge of everything that happens on the shop floor day to day'
			const cut = guardScalarFields(
				person({ value: headline, ...at(quote) }),
				`acme. ${quote}`,
			)
			const long = guardScalarFields(
				person({ value: sentence, ...at(sentence) }),
				`acme. ${sentence}`,
			)

			// THEN the first post stands alone, and the sentence goes
			expect(roleOf(cut.findings)).toEqual({
				value: 'Operation Manager',
				...at(quote),
			})
			expect(roleOf(long.findings)).toBeNull()
			expect(long.droppedNotTitle).toBe(1)
		})
	})

	describe('when the quote is the page’s line reworded', () => {
		it('should drop the title as absent from the page', () => {
			// GIVEN a Catalan page and a quote the model rewrote into Spanish
			const page = 'segons explica el seu propietari, Ramon Vendrell'
			const result = guardScalarFields(
				person({
					value: 'propietario',
					...at('según explica el su propietario, Ramon Vendrell'),
				}),
				`acme. ${page}`,
			)

			// THEN the title goes: most of the words are on the page, the line is not
			expect(roleOf(result.findings)).toBeNull()
			expect(result.droppedQuoteAbsent).toBe(1)
		})

		it('should keep a title whose quote is the page’s line, in the page’s word', () => {
			// GIVEN the same page quoted faithfully and a title inflected the model's way
			const page = 'segons explica el seu propietari, Ramon Vendrell'
			const result = guardScalarFields(
				person({ value: 'propietario', ...at(page) }),
				`acme. ${page}`,
			)

			// THEN the title stands as the page writes it
			expect(roleOf(result.findings)).toEqual({
				value: 'propietari',
				...at(page),
			})
		})
	})

	describe('when the rendering is a remark, or nothing', () => {
		it('should strip a rendering with a bracket, a bar, or too many words', () => {
			// GIVEN renderings the model padded with its own explanation
			const quote = 'Directeur de publication : Stéphane Viers, Président'
			for (const gloss of [
				'Publisher‑Director (he is also the President)',
				'President | Publisher',
				'the person who runs the company as its president',
			]) {
				// WHEN grounded
				const result = guardScalarFields(
					person({ value: 'Président', gloss, ...at(quote) }),
					`acme. ${quote}`,
				)
				// THEN the title stands and the rendering goes
				expect(roleOf(result.findings), gloss).toEqual({
					value: 'Président',
					...at(quote),
				})
			}
		})

		it('should strip a rendering the model left null', () => {
			// GIVEN an English title with the rendering slot filled with null
			const quote = 'Ana Puig, CEO of Acme'
			const result = guardScalarFields(
				person({ value: 'CEO', gloss: null, ...at(quote) }),
				`acme. ${quote}`,
			)

			// THEN the null slot is gone
			expect(roleOf(result.findings)).toEqual({ value: 'CEO', ...at(quote) })
		})
	})

	describe('when a title carries a date it is said to hold as of', () => {
		it('should keep the date only when the quote names its year', () => {
			// GIVEN one quote that names the year and one that does not
			const dated = 'Ana Puig, gerente desde 2019'
			const undated = 'Ana Puig, gerente'
			const kept = guardScalarFields(
				person({ value: 'gerente', as_of: '2019-05-01', ...at(dated) }),
				`acme. ${dated}`,
			)
			const stripped = guardScalarFields(
				person({ value: 'gerente', as_of: '2024-09-15', ...at(undated) }),
				`acme. ${undated}`,
			)

			// THEN the first keeps it and the second loses a date written from memory
			expect(roleOf(kept.findings)).toEqual({
				value: 'gerente',
				as_of: '2019-05-01',
				...at(dated),
			})
			expect(roleOf(stripped.findings)).toEqual({
				value: 'gerente',
				...at(undated),
			})
		})
	})

	describe('when the rendering is a word of the title itself', () => {
		it('should strip it, and keep a rendering into other words', () => {
			// GIVEN English titles rendered with one of their own words, and a
			// Catalan title rendered into English
			const cases = [
				['Sales Director', 'Director', 'Ana Puig, Sales Director', false],
				['Founder & CEO', 'CEO', 'Ana Puig, Founder & CEO', false],
				['Gerent', 'Manager', 'Ana Puig, gerent', true],
				['Directora', 'Director', 'Ana Puig, directora', true],
			] as const

			for (const [value, gloss, quote, kept] of cases) {
				// WHEN grounded
				const result = guardScalarFields(
					person({ value, gloss, ...at(quote) }),
					`acme. ${quote}`,
				)
				// THEN the rendering stays only when it says something the title does not
				expect(roleOf(result.findings), value).toEqual(
					kept ? { value, gloss, ...at(quote) } : { value, ...at(quote) },
				)
			}
		})
	})
})
