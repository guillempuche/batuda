import { describe, expect, it } from 'vitest'

import { BUYING_ROLES, decidesPurchase } from '@batuda/domain'

import {
	cleanIndustryLabel,
	constrainVocabulary,
	mapBuyingRole,
	mapCountry,
	mapSizeRange,
} from './vocabulary-guard'

describe('cleanIndustryLabel', () => {
	describe('when the text names a trade', () => {
		it('should keep it as written', () => {
			// GIVEN trades a page might name, in any language
			// WHEN each is cleaned
			// THEN the trade survives instead of being folded into one of a fixed
			//      few — the organisation's own list is what decides these now
			expect(cleanIndustryLabel('Bicycle Manufacturing Ltd')).toBe(
				'Bicycle Manufacturing Ltd',
			)
			expect(cleanIndustryLabel('empresa de logística')).toBe(
				'empresa de logística',
			)
			expect(cleanIndustryLabel('activewear & apparel')).toBe(
				'activewear & apparel',
			)
		})

		it('should keep a trade that used to have nowhere to go', () => {
			// GIVEN a real trade that fit none of the nine words the app shipped with,
			// so it used to be stored as "other" and lost
			// WHEN it is cleaned
			// THEN it comes through, which is the point of the change
			expect(cleanIndustryLabel('artisanal cheese production')).toBe(
				'artisanal cheese production',
			)
			expect(cleanIndustryLabel('agriculture')).toBe('agriculture')
		})

		it('should not decide that one trade is really another', () => {
			// GIVEN a consultancy whose name contains "industrial". The old ordered
			// keyword match filed this under manufacturing.
			expect(cleanIndustryLabel('Consultoría industrial')).toBe(
				'Consultoría industrial',
			)
		})

		it('should tidy the spacing without changing the words', () => {
			expect(cleanIndustryLabel('  Metal   fabrication ')).toBe(
				'Metal fabrication',
			)
		})
	})

	describe('when the text is not a trade at all', () => {
		it('should blank a URL, an email, or a placeholder', () => {
			// GIVEN what the model emits for a field it could not fill
			// WHEN each is cleaned
			// THEN it is blanked, so it never becomes an entry in somebody's list
			expect(cleanIndustryLabel('https://acme.com')).toBeNull()
			expect(cleanIndustryLabel('info@acme.com')).toBeNull()
			expect(cleanIndustryLabel('N/A')).toBeNull()
			expect(cleanIndustryLabel('')).toBeNull()
		})

		it('should blank a whole sentence', () => {
			// GIVEN a model answering in prose rather than naming a trade. Storing the
			// sentence would put it in the organisation's list for everyone to see.
			expect(
				cleanIndustryLabel(
					'We are a company that does many things across sectors',
				),
			).toBeNull()
			// AND the wordy label that the old keyword rules used to rescue is now
			// blanked too — it is a list of services, not the name of one trade.
			expect(
				cleanIndustryLabel(
					'Third-party logistics (3PL), transportation, warehousing, customs clearance',
				),
			).toBeNull()
		})
	})
})

describe('mapSizeRange', () => {
	describe('when the text is an exact bucket', () => {
		it('should keep it', () => {
			// GIVEN a value that already matches a band
			expect(mapSizeRange('11-50')).toBe('11-50')
		})
	})

	describe('when the text is a head-count or a range', () => {
		it('should bucket the first integer', () => {
			// GIVEN a head-count or a range in words
			expect(mapSizeRange('50 employees')).toBe('11-50')
			expect(mapSizeRange('12')).toBe('11-50')
			expect(mapSizeRange('10 to 20 staff')).toBe('1-10')
			expect(mapSizeRange('3')).toBe('1-10')
		})

		it('should bucket a mid-to-large company into its own band', () => {
			// GIVEN companies above the old 51-200 ceiling — these used to all collapse
			// to 51-200, so a 500-person company read as small and its band contradicted
			// its own evidence quote
			expect(mapSizeRange('201-500')).toBe('201-500')
			expect(mapSizeRange('500')).toBe('201-500')
			expect(mapSizeRange('501-1,000')).toBe('501-1000')
			// AND a head-count written with a thousands separator — "1,700" must read
			// as 1700, not 1, so a large company is not bucketed as 1-5
			expect(mapSizeRange('1,700 employees')).toBe('1001-5000')
			expect(mapSizeRange('1.700 empleados')).toBe('1001-5000')
			// AND a size written as a long sentence still buckets on its first integer,
			// instead of being discarded for having more than five words
			expect(
				mapSizeRange('over 1,700 employees across North America and Europe'),
			).toBe('1001-5000')
		})

		it('should tell one very large company from another', () => {
			// GIVEN companies large enough that the differences between them matter:
			// who buys and how long it takes is not the same question at eight
			// thousand people as at two hundred thousand
			expect(mapSizeRange('8000 employees')).toBe('5001-25000')
			expect(mapSizeRange('40,000 employees')).toBe('25001-100000')
			expect(mapSizeRange('165,000 employees')).toBe('100001+')
		})
	})

	describe('when the size is qualitative or junk', () => {
		it('should blank it to null', () => {
			// GIVEN a size with no head-count
			expect(mapSizeRange('SME')).toBeNull()
			expect(mapSizeRange('small')).toBeNull()
			expect(mapSizeRange('N/A')).toBeNull()
		})
	})
})

describe('mapCountry', () => {
	describe('when the value is a full country name or a code', () => {
		it('should fold a name to its ISO code and keep an existing code', () => {
			// GIVEN the names an extractor emits instead of the ISO code
			expect(mapCountry('France')).toBe('FR')
			expect(mapCountry('United Kingdom')).toBe('GB')
			expect(mapCountry('España')).toBe('ES')
			expect(mapCountry('USA')).toBe('US')
			// AND a code it already emitted is kept, upper-cased
			expect(mapCountry('de')).toBe('DE')
			expect(mapCountry('FR')).toBe('FR')
		})
	})

	describe('when the country is unknown or junk', () => {
		it('should keep an unlisted country but blank hard junk', () => {
			// GIVEN a real country not in the table — kept, never destroyed
			expect(mapCountry('Andorra')).toBe('Andorra')
			// AND junk the model emits for a field it could not fill — blanked
			expect(mapCountry('https://acme.com')).toBeNull()
			expect(mapCountry('N/A')).toBeNull()
			expect(mapCountry('')).toBeNull()
		})
	})
})

describe('constrainVocabulary', () => {
	describe('when an enrichment block holds mappable and junk values', () => {
		it('should rewrite the mappable ones, drop the junk key, and count both', () => {
			// GIVEN an enrichment block mixing a mappable industry, a qualitative
			// (unmappable) size, and an untouched free-text field
			const findings = {
				enrichment: {
					industry: 'freight & logistics',
					size_range: 'small',
					current_tools: 'a spreadsheet',
				},
			}

			// WHEN constrained to the CRM codes
			const result = constrainVocabulary(findings)

			// THEN the trade is kept as the page wrote it — it is the organisation's
			// list that decides trades now, not a fixed set of codes — while the
			// qualitative size key is dropped and the free-text field is untouched
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['industry']).toBe('freight & logistics')
			expect(e).not.toHaveProperty('size_range')
			expect(e['current_tools']).toBe('a spreadsheet')
			// AND nothing was rewritten, because only the size was a fixed vocabulary
			expect(result.mapped).toBe(0)
			expect(result.blanked).toBe(1)
		})
	})

	describe('when a target field sits inside a proposed update', () => {
		it('should map it there too and drop a junk field, emptying the proposal', () => {
			// GIVEN a proposal whose only field is a junk industry
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { industry: 'https://junk' } },
				],
			}

			// WHEN constrained
			const result = constrainVocabulary(findings)

			// THEN the junk key is gone, leaving an empty fields object the
			// applicability guard drops next
			const p = (
				result.findings as {
					proposed_updates: Array<{ fields: Record<string, unknown> }>
				}
			).proposed_updates
			expect(p[0]?.fields).toEqual({})
			expect(result.blanked).toBe(1)
		})
	})

	describe('when a field is a { value, source_id } wrapper', () => {
		it('should reach the inner value and preserve the wrapper', () => {
			// GIVEN a per-field sourced wrapper (the citations slice's shape) holding
			// a country, which really does have a fixed set of codes
			const findings = {
				enrichment: {
					country: { value: 'France', source_id: 's1' },
				},
			}

			// WHEN constrained
			const result = constrainVocabulary(findings)

			// THEN the inner value is rewritten and the source rides along, so a fact
			// keeps the page it was read from
			const e = (result.findings as { enrichment: { country: unknown } })
				.enrichment
			expect(e.country).toEqual({ value: 'FR', source_id: 's1' })
			expect(result.mapped).toBe(1)
		})

		it('should leave a trade in a wrapper as written', () => {
			// GIVEN the same shape holding a trade, which no longer has a fixed set
			const findings = {
				enrichment: {
					industry: { value: 'apparel retailer', source_id: 's1' },
				},
			}

			const result = constrainVocabulary(findings)

			const e = (result.findings as { enrichment: { industry: unknown } })
				.enrichment
			expect(e.industry).toEqual({ value: 'apparel retailer', source_id: 's1' })
			expect(result.mapped).toBe(0)
		})
	})

	describe('when the enrichment country is a full name in a wrapper', () => {
		it('should fold it to the ISO code the CRM stores', () => {
			// GIVEN the Lectra shape: the model emitted "France" with a source
			const findings = {
				enrichment: { country: { value: 'France', source_id: 's1' } },
			}

			// WHEN constrained
			const result = constrainVocabulary(findings)

			// THEN it becomes FR, keeping its source — the field the eval scores matches
			const e = (result.findings as { enrichment: { country: unknown } })
				.enrichment
			expect(e.country).toEqual({ value: 'FR', source_id: 's1' })
			expect(result.mapped).toBe(1)
		})
	})

	describe('when findings is not a plain object', () => {
		it('should return degenerate inputs unchanged with zero counters', () => {
			// GIVEN null, a primitive, and an array
			// THEN each is returned untouched with no mapping
			expect(constrainVocabulary(null)).toEqual({
				findings: null,
				mapped: 0,
				blanked: 0,
			})
			expect(constrainVocabulary('x')).toEqual({
				findings: 'x',
				mapped: 0,
				blanked: 0,
			})
			expect(constrainVocabulary([1, 2]).findings).toEqual([1, 2])
		})
	})
})

describe('mapBuyingRole', () => {
	describe('when the model names the part in its own words', () => {
		it('should fold the phrases that mean whoever holds the budget', () => {
			// GIVEN the words a model reaches for instead of the fixed one — this is
			// the case that matters, because stored as typed it reads as somebody who
			// does NOT decide, which is the opposite of the truth
			for (const raw of [
				'Decision maker',
				'decision-maker',
				'Economic Buyer',
				'the owner',
				'Founder',
				'budget holder',
			]) {
				expect(mapBuyingRole(raw), raw).toBe('economic_buyer')
			}
			// AND that value then reads as somebody worth reaching
			expect(decidesPurchase(mapBuyingRole('Decision maker'))).toBe(true)
		})

		it('should fold the other four parts too', () => {
			expect(mapBuyingRole('Internal champion')).toBe('champion')
			expect(mapBuyingRole('Head of Procurement')).toBe('gatekeeper')
			expect(mapBuyingRole('Technical Evaluator')).toBe('technical_evaluator')
			expect(mapBuyingRole('end user')).toBe('user')
		})

		it('should pass a value already in the vocabulary straight through', () => {
			for (const code of BUYING_ROLES) {
				expect(mapBuyingRole(code), code).toBe(code)
			}
		})
	})

	describe('when the words mean nothing the vocabulary knows', () => {
		it('should say nothing rather than invent a part', () => {
			// GIVEN prose, junk, or a part this vocabulary has no word for
			for (const raw of ['n/a', '', 'purple', 'they were quite helpful']) {
				expect(mapBuyingRole(raw), raw).toBeNull()
			}
			// THEN nothing is claimed — saying nothing about how somebody decides is
			// honest, where a made-up part puts an invented person in front of a
			// salesperson
			expect(decidesPurchase(mapBuyingRole('purple'))).toBe(false)
		})
	})
})
