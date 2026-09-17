import { describe, expect, it } from 'vitest'

import { cleanQuote, tidyQuotes } from './citation-text'

describe('cleanQuote, when a model dresses the words it copied', () => {
	describe("when a search result's citation marker follows the words", () => {
		it('should take the marker and its full stop off', () => {
			// GIVEN a snippet quoted in the search result's own citation style
			const dressed =
				'“Número de empleados = 23 (año 2024)”​[source: einforma.com]​.'
			// WHEN tidied
			// THEN only the page's words remain
			expect(cleanQuote(dressed)).toBe('Número de empleados = 23 (año 2024)')
		})
	})

	describe('when the words are wrapped in quote marks of several kinds', () => {
		it('should take a matching pair off and leave a lone mark', () => {
			// GIVEN straight, curly and angled marks around one line
			for (const wrapped of ['"President"', '“President”', '«President»']) {
				expect(cleanQuote(wrapped), wrapped).toBe('President')
			}
			// AND a mark that opens without closing is part of the words
			expect(cleanQuote('"Jordi Solà – President')).toBe(
				'"Jordi Solà – President',
			)
		})

		it('should leave a line whole when the marks are two quotations inside it', () => {
			// GIVEN a sentence that opens and closes with marks of its own
			const line = '"Acme" opera en el sector de la "logística"'
			// WHEN tidied
			// THEN nothing is cut, since the pair is not one wrapping
			expect(cleanQuote(line)).toBe(line)
		})
	})

	describe('when the words carry a footnote number', () => {
		it('should take the footnote off', () => {
			expect(cleanQuote('family-owned since 1889[3]')).toBe(
				'family-owned since 1889',
			)
		})
	})

	describe('when the words are nothing but a marker', () => {
		it('should leave nothing behind', () => {
			// GIVEN a quote the model wrote as the citation style alone
			expect(cleanQuote('[source: einforma.com]')).toBe('')
		})
	})

	describe('when a quote is already plain', () => {
		it('should return it as written', () => {
			expect(cleanQuote('Fundada por Benet Badia en 1889')).toBe(
				'Fundada por Benet Badia en 1889',
			)
		})
	})
})

describe('tidyQuotes, over the findings a run wrote', () => {
	describe('when quotes sit at several depths', () => {
		it('should tidy each and count them', () => {
			// GIVEN a wrapped quote on a contact and a marked one on a scan row's
			// person
			const findings = {
				contacts: [
					{
						name: 'Jordi Solà',
						citations: [
							{ quote: '"Jordi Solà – President"', source_id: 'https://s.com' },
						],
					},
				],
				prospects: [
					{
						name: 'Mefram',
						contacts: [
							{
								name: 'Ana Puig',
								citations: [
									{
										quote: 'Ana Puig, gerent [source: mefram.es]',
										source_id: 'https://mefram.es/equip',
									},
								],
							},
						],
					},
				],
			}
			// WHEN tidied
			const result = tidyQuotes(findings)
			// THEN both quotes are the page's words
			const tidy = result.findings as {
				contacts: Array<{ citations: Array<{ quote: string }> }>
				prospects: Array<{
					contacts: Array<{ citations: Array<{ quote: string }> }>
				}>
			}
			expect(tidy.contacts[0]?.citations[0]?.quote).toBe(
				'Jordi Solà – President',
			)
			expect(tidy.prospects[0]?.contacts[0]?.citations[0]?.quote).toBe(
				'Ana Puig, gerent',
			)
			expect(result.cleaned).toBe(2)
		})
	})

	describe('when a fit check quotes with a marker', () => {
		it('should tidy evidence_quote too', () => {
			// GIVEN a fit check whose quote ends in a source marker
			const findings = {
				fit_checks: [
					{
						criterion: 'size',
						evidence_quote: '105 employees [source: cdti.es]',
					},
				],
			}
			// WHEN tidied
			const result = tidyQuotes(findings)
			// THEN the marker is gone
			expect(
				(result.findings as { fit_checks: Array<{ evidence_quote: string }> })
					.fit_checks[0]?.evidence_quote,
			).toBe('105 employees')
		})
	})

	describe('when nothing needs tidying', () => {
		it('should hand the findings back as they were, untouched at every depth', () => {
			// GIVEN plain quotes on distinct pages
			const findings = {
				contacts: [
					{
						name: 'Ana',
						citations: [{ quote: 'Ana, CEO', source_id: 'https://a.es' }],
					},
				],
			}
			// WHEN tidied
			const result = tidyQuotes(findings)
			// THEN the same object comes back, nothing counted
			expect(result.findings).toBe(findings)
			expect(result.cleaned).toBe(0)
		})
	})
})
