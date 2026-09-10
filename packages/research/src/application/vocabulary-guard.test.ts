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
			// as 1700, not 1, so a large company is not bucketed as 1-10
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

	describe('when the value names a country and then qualifies it', () => {
		it('should leave it alone rather than read past the bracket', () => {
			// GIVEN values where the bracket is what says WHICH country. Reading the
			// name off the front answers confidently and wrongly.
			expect(mapCountry('Korea (North)')).toBe('Korea (North)')
			expect(mapCountry('China (Taiwan)')).toBe('China (Taiwan)')
			expect(mapCountry('Ireland (Northern)')).toBe('Ireland (Northern)')
			// AND one where reading past it would have been right — kept as written
			// all the same, because nothing here can tell the two kinds apart
			expect(mapCountry('Spain (global)')).toBe('Spain (global)')
		})

		it('should leave a country the run was unsure of alone', () => {
			// GIVEN a value where the question mark is the run saying it does not
			// know which country this is
			const hedged = 'Portugal? (uncertain – site uses .br domain)'

			// WHEN folded — THEN it stays as written, because answering "PT" would
			// state as fact something the run explicitly did not settle
			expect(mapCountry(hedged)).toBe(hedged)
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

describe('a trade written in a system with no word spaces', () => {
	describe('when a model answers in prose instead of naming a trade', () => {
		it('should refuse the sentence rather than store it as the trade', () => {
			// GIVEN a model saying, in Chinese, Japanese and Thai, that it could not
			// find what the company does
			// WHEN each is cleaned
			// THEN each is refused. Counting spaces made every one of these a single
			// word, so a whole sentence was stored in the organisation's trade list —
			// where it also takes a key with a uniqueness rule on it
			expect(
				cleanIndustryLabel(
					'我们没有找到这家公司从事的具体行业，因此无法给出答案',
				),
			).toBeNull()
			expect(
				cleanIndustryLabel(
					'この会社が具体的にどのような業種に従事しているかは見つかりませんでした',
				),
			).toBeNull()
			expect(cleanIndustryLabel('ไม่พบข้อมูลว่าบริษัทนี้ประกอบธุรกิจประเภทใด')).toBeNull()
		})
	})

	describe('when the value really is a trade', () => {
		it('should keep it, short or long', () => {
			// GIVEN real trade names of two, six and fourteen letters, and a Thai one
			// whose vowels are written as marks around its letters
			// WHEN cleaned
			// THEN each is kept. A rule that refused these would have moved the
			// failure rather than fixed it
			expect(cleanIndustryLabel('物流')).toBe('物流')
			expect(cleanIndustryLabel('建筑安装工程')).toBe('建筑安装工程')
			expect(cleanIndustryLabel('一般社団法人 日本電設工業協会')).toBe(
				'一般社団法人 日本電設工業協会',
			)
			expect(cleanIndustryLabel('รับเหมาก่อสร้าง')).toBe('รับเหมาก่อสร้าง')
		})

		it('should keep a trade in another language for carrying one such letter', () => {
			// GIVEN a Spanish trade that happens to name a Chinese market
			// WHEN cleaned
			// THEN kept. Only the part with no words to count is measured by its
			// letters — measuring the whole value refused this for one character
			expect(
				cleanIndustryLabel('Instalaciones eléctricas y climatización 中国'),
			).toBe('Instalaciones eléctricas y climatización 中国')
		})
	})
})

describe('a country named in its own writing', () => {
	describe('when a run answers in the language of the country it searched', () => {
		it('should give the code the CRM stores, not the name as written', () => {
			// GIVEN countries written as their own people write them
			// WHEN mapped
			// THEN each comes back as its two-letter code. Left unmapped, the name
			// itself is what a person reads in the findings where a code belongs
			expect(mapCountry('中国')).toBe('CN')
			expect(mapCountry('日本')).toBe('JP')
			expect(mapCountry('Россия')).toBe('RU')
			expect(mapCountry('대한민국')).toBe('KR')
			expect(mapCountry('مصر')).toBe('EG')
			// Both spellings of an opening alef, since taking marks off does not reach
			// the hamza — it makes a different letter rather than decorating one
			expect(mapCountry('الإمارات')).toBe('AE')
		})
	})

	describe('when the country is one this table has never been told about', () => {
		it('should pass it through rather than drop a real answer', () => {
			// GIVEN a country name the table does not carry
			// WHEN mapped
			// THEN it survives as written. Refusing what cannot be mapped would throw
			// away real countries simply for being absent from a hand-written list
			expect(mapCountry('Freedonia')).toBe('Freedonia')
		})
	})
})

describe('constrainVocabulary on a scan row', () => {
	const prospects = (countries: unknown) => ({
		prospects: [{ name: 'Acme', countries }],
	})
	const countriesOf = (result: { findings: unknown }): unknown =>
		(
			(result.findings as { prospects: ReadonlyArray<Record<string, unknown>> })
				.prospects[0] as Record<string, unknown>
		)['countries']

	describe('when a scan names its countries in words', () => {
		it('should fold every one of them to a code', () => {
			// GIVEN the spellings real scans have written into the list
			const result = constrainVocabulary(
				prospects(['Spain', 'España', 'Portugal', 'United States']),
			)

			// WHEN folded — THEN each is a code, and the two spellings of Spain
			// become one entry rather than the same country listed twice
			expect(countriesOf(result)).toEqual(['ES', 'PT', 'US'])
			expect(result.mapped).toBe(4)
		})

		it('should leave a list already written as codes alone', () => {
			// GIVEN a list the model wrote correctly
			const result = constrainVocabulary(prospects(['ES', 'FR']))

			// WHEN folded — THEN nothing is rewritten and nothing is counted
			expect(countriesOf(result)).toEqual(['ES', 'FR'])
			expect(result.mapped).toBe(0)
		})
	})

	describe('when the list holds junk beside a real country', () => {
		it('should drop the junk and keep the country', () => {
			// GIVEN a list where the model filled one slot with a placeholder
			const result = constrainVocabulary(
				prospects(['Spain', 'N/A', 'https://acme.example']),
			)

			// WHEN folded — THEN the country survives and the two placeholders go
			expect(countriesOf(result)).toEqual(['ES'])
			expect(result.blanked).toBe(2)
		})

		it('should drop the field when nothing in it was usable', () => {
			// GIVEN a list of nothing but placeholders
			const result = constrainVocabulary(prospects(['N/A', '']))

			// WHEN folded — THEN the key is gone rather than left as an empty list,
			// which would read as a run that looked and found no country
			expect(countriesOf(result)).toBeUndefined()
		})
	})

	describe('when a field is named after something every object already has', () => {
		it('should leave it alone rather than treat a built-in as a rule', () => {
			// GIVEN a row carrying keys that every JavaScript object answers to, which
			// a plain lookup finds on the prototype and mistakes for a mapping rule.
			// `toString` used to come back rewritten as "[object Undefined]".
			const result = constrainVocabulary({
				prospects: [{ constructor: 'x', toString: 'y', countries: ['Spain'] }],
			})

			// WHEN folded — THEN both survive as written, and the real field beside
			// them is still folded
			expect(result.findings).toEqual({
				prospects: [{ constructor: 'x', toString: 'y', countries: ['ES'] }],
			})
		})

		it('should not read a country name off the prototype either', () => {
			// GIVEN a country whose name matches a built-in. Looked up plainly this
			// answered with a function, which then travelled on as the country.
			expect(mapCountry('constructor')).toBe('constructor')
			expect(mapCountry('valueOf')).toBe('valueOf')
		})
	})

	describe('when the list holds something that is not a country at all', () => {
		it('should drop it rather than leave it looking like one', () => {
			// GIVEN entries that are not values this mapper can read — an object
			// where a name belongs, a number, a null
			const result = constrainVocabulary(
				prospects([{ odd: 'shape' }, 'Spain', 5, null]),
			)

			// WHEN folded — THEN only the country survives. Carrying the rest along
			// would leave a list that reads as countries and holds something else,
			// which every later reader would take at face value.
			expect(countriesOf(result)).toEqual(['ES'])
			expect(result.blanked).toBe(3)
		})
	})
})
