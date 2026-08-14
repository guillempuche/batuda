import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
	parseGoldenRow,
	parseGoldenSet,
	type RawGoldenRow,
} from './eval-golden'

const row = (over: Partial<RawGoldenRow>): RawGoldenRow => ({
	id: 'acme',
	query: 'Acme Logistics, Barcelona',
	expectedOutput: { officialDomain: 'acme.es' },
	...over,
})

describe('parseGoldenRow', () => {
	describe('when the expected output is a well-formed object', () => {
		it('should build a golden expectation', () => {
			// GIVEN an answer with a domain, alt domains, and fields
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'acme.es',
						altDomains: ['librebor.es'],
						fields: { industry: 'transport', country: 'ES' },
					},
				}),
			)

			// WHEN parsed — THEN every part is carried through
			expect(result).toEqual({
				ok: true,
				value: {
					id: 'acme',
					query: 'Acme Logistics, Barcelona',
					officialDomain: 'acme.es',
					altDomains: ['librebor.es'],
					fields: { industry: 'transport', country: 'ES' },
				},
			})
		})
	})

	describe('when the expected output is a JSON string (a CSV export)', () => {
		it('should parse the string before validating', () => {
			// GIVEN the answer as text rather than a parsed object
			const result = parseGoldenRow(
				row({ expectedOutput: '{"officialDomain":"acme.es"}' }),
			)

			// WHEN parsed — THEN it still validates
			expect(result.ok).toBe(true)
		})
	})

	describe('when the query is empty', () => {
		it('should fail — there is nothing to research', () => {
			// GIVEN a blank query
			const result = parseGoldenRow(row({ query: '   ' }))

			// WHEN parsed — THEN it is rejected
			expect(result).toMatchObject({ ok: false })
		})
	})

	describe('when the expected output is not a JSON object', () => {
		it('should fail rather than guess', () => {
			// GIVEN a non-object answer
			expect(parseGoldenRow(row({ expectedOutput: 42 })).ok).toBe(false)
			// AND an unparseable string
			expect(parseGoldenRow(row({ expectedOutput: 'not json' })).ok).toBe(false)
		})
	})

	describe('when the official domain is missing', () => {
		it('should fail — the grounding anchor is required', () => {
			// GIVEN an answer with only fields, no domain
			const result = parseGoldenRow(
				row({ expectedOutput: { fields: { industry: 'transport' } } }),
			)

			// WHEN parsed — THEN it is rejected
			expect(result.ok).toBe(false)
		})
	})

	describe('when a field name is misspelled', () => {
		it('should fail loudly so bad golden data is caught', () => {
			// GIVEN a typo'd field the scorer does not know
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'acme.es',
						fields: { industies: 'transport' },
					},
				}),
			)

			// WHEN parsed — THEN it names the offending field
			expect(result).toMatchObject({ ok: false })
			if (!result.ok) expect(result.error).toContain('industies')
		})
	})

	describe('when a field value is not a string', () => {
		it('should fail', () => {
			// GIVEN a numeric field value
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'acme.es',
						fields: { country: 5 },
					},
				}),
			)

			// WHEN parsed — THEN it is rejected
			expect(result.ok).toBe(false)
		})
	})

	describe('when altDomains is not an array of strings', () => {
		it('should fail', () => {
			// GIVEN a malformed altDomains
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'acme.es',
						altDomains: 'librebor.es',
					},
				}),
			)

			// WHEN parsed — THEN it is rejected
			expect(result.ok).toBe(false)
		})
	})

	describe('when contacts are given as names and objects', () => {
		it('should accept both forms and carry the names through', () => {
			// GIVEN a bare name string and a { name } object side by side
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'acme.es',
						contacts: ['Ada Lovelace', { name: 'Alan Turing' }],
					},
				}),
			)

			// WHEN parsed — THEN both are normalized to { name } entries
			expect(result).toMatchObject({
				ok: true,
				value: {
					contacts: [{ name: 'Ada Lovelace' }, { name: 'Alan Turing' }],
				},
			})
		})
	})

	describe('when a row lists no contacts', () => {
		it('should omit the contacts key rather than emit an empty array', () => {
			// GIVEN a well-formed row with no contacts field
			const result = parseGoldenRow(
				row({ expectedOutput: { officialDomain: 'acme.es' } }),
			)

			// WHEN parsed — THEN contacts is absent, so recall stays inert (not 0/0)
			expect(result).toMatchObject({ ok: true })
			if (result.ok) expect('contacts' in result.value).toBe(false)
		})
	})

	describe('when contacts is not an array', () => {
		it('should fail rather than guess', () => {
			// GIVEN a single object where an array is required
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'acme.es',
						contacts: { name: 'Ada Lovelace' },
					},
				}),
			)

			// WHEN parsed — THEN it is rejected
			expect(result.ok).toBe(false)
		})
	})

	describe('when a contact has no usable name', () => {
		it('should fail — a nameless contact cannot be matched', () => {
			// GIVEN a blank name and, separately, a nameless object
			expect(
				parseGoldenRow(
					row({
						expectedOutput: { officialDomain: 'acme.es', contacts: ['  '] },
					}),
				).ok,
			).toBe(false)
			expect(
				parseGoldenRow(
					row({
						expectedOutput: {
							officialDomain: 'acme.es',
							contacts: [{ role: 'CEO' }],
						},
					}),
				).ok,
			).toBe(false)
		})
	})
})

describe('parseGoldenSet', () => {
	describe('when the set mixes good and bad rows', () => {
		it('should keep the valid ones and collect a reason per bad one', () => {
			// GIVEN one good row and one with no domain
			const result = parseGoldenSet([
				row({ id: 'good' }),
				row({ id: 'bad', expectedOutput: {} }),
			])

			// WHEN parsed — THEN the good survives and the bad is reported by id
			expect(result.golden).toHaveLength(1)
			expect(result.golden[0]?.id).toBe('good')
			expect(result.errors).toEqual([
				{ id: 'bad', error: expect.stringContaining('officialDomain') },
			])
		})
	})

	describe('when parsing the shipped golden.example.json', () => {
		it('should parse every row and score the US logistics headcount+location row', () => {
			// GIVEN the golden set the eval CLI ships — a malformed row here would
			// silently shrink live coverage
			const raw = JSON.parse(
				readFileSync(
					new URL('../../../../eval/golden.example.json', import.meta.url),
					'utf8',
				),
			) as ReadonlyArray<RawGoldenRow>

			// WHEN parsed
			const result = parseGoldenSet(raw)

			// THEN nothing is rejected AND the Arrive Logistics row asserts the
			// headcount (size_range) + location an earlier run lost from a search snippet
			expect(result.errors).toEqual([])
			const arrive = result.golden.find(g => g.id === 'arrive-logistics')
			expect(arrive?.fields.size_range).toBe('51-200')
			expect(arrive?.fields.location).toBe('Austin')
			expect(arrive?.fields.country).toBe('US')
			// AND the Brompton row carries the contact that seeds titled-contact recall
			const brompton = result.golden.find(g => g.id === 'brompton-bicycle')
			expect(brompton?.contacts).toEqual([{ name: 'Will Butler-Adams' }])
		})
	})
})

describe('parseGoldenRow — bucket', () => {
	describe('when the expected output carries a known bucket', () => {
		it('should carry it through onto the expectation', () => {
			// GIVEN an answer tagged with a valid size/reach bucket
			const result = parseGoldenRow(
				row({ expectedOutput: { officialDomain: 'acme.es', bucket: 'niche' } }),
			)
			// WHEN parsed — THEN the bucket is on the expectation
			expect(result).toEqual({
				ok: true,
				value: {
					id: 'acme',
					query: 'Acme Logistics, Barcelona',
					officialDomain: 'acme.es',
					fields: {},
					bucket: 'niche',
				},
			})
		})
	})

	describe('when the bucket is not a known value', () => {
		it('should reject the row loudly, like any other typo', () => {
			// GIVEN an answer tagged with a bucket that is not big/small/niche
			const result = parseGoldenRow(
				row({ expectedOutput: { officialDomain: 'acme.es', bucket: 'huge' } }),
			)
			// WHEN parsed — THEN it fails rather than silently ignoring the tag
			expect(result.ok).toBe(false)
		})
	})

	describe('when no bucket is given', () => {
		it('should omit the bucket key entirely', () => {
			// GIVEN an untagged row
			const result = parseGoldenRow(row({}))
			// WHEN parsed — THEN there is no bucket key (not an undefined one)
			expect(result.ok).toBe(true)
			if (result.ok) expect('bucket' in result.value).toBe(false)
		})
	})
})

describe('parseGoldenRow for the company shapes this measures', () => {
	describe('when the company has no website of its own', () => {
		it('should accept the row when an alt domain proves the target', () => {
			// GIVEN a market-stall-shaped company whose only public record is a
			// register entry
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						altDomains: ['librebor.es'],
						fields: { country: 'ES' },
					},
				}),
			)

			// THEN the row is usable, with no official domain to score grounding on
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.officialDomain).toBeNull()
				expect(result.value.altDomains).toEqual(['librebor.es'])
			}
		})

		it('should still reject a row that names no address at all', () => {
			// GIVEN neither an official domain nor an alt one, so nothing could ever
			// prove the run reached the right company
			const result = parseGoldenRow(row({ expectedOutput: { fields: {} } }))

			// THEN it is refused, with the reason naming what is missing
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error).toContain('officialDomain')
				expect(result.error).toContain('altDomains')
			}
		})
	})

	describe('when a row states the company own mailbox or number', () => {
		it('should accept them as scored fields', () => {
			// GIVEN a thin-web company whose one reachable address is a role mailbox
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'tallerpuig.es',
						fields: {
							email: 'info@tallerpuig.es',
							phone: '+34 972 123 456',
							tax_id: 'B-12345678',
						},
					},
				}),
			)

			// THEN all three are kept — they each have one right answer to check
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.fields).toEqual({
					email: 'info@tallerpuig.es',
					phone: '+34 972 123 456',
					tax_id: 'B-12345678',
				})
			}
		})

		it('should still reject a field name that is not scored', () => {
			// GIVEN the company's website, which grounding already measures
			const result = parseGoldenRow(
				row({
					expectedOutput: {
						officialDomain: 'acme.es',
						fields: { website: 'acme.es' },
					},
				}),
			)

			// THEN a key outside the scored list is refused loudly rather than
			// silently ignored
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.error).toContain('website')
		})
	})
})

describe('parseGoldenRow — a row that asks for a whole market', () => {
	const marketRow = (market: unknown): RawGoldenRow =>
		row({
			id: 'es-installations',
			query: 'Empresas instaladoras en España',
			expectedOutput: { market },
		})

	const validMarket = {
		name: 'ES',
		parts: [{ id: 'electrical', terms: ['instalacion electrica'] }],
		notCompanies: ['FENIE'],
	}

	describe('when the answer carries a well-formed market block', () => {
		it('should accept it without any company address', () => {
			// GIVEN a market request, which names no company and so no site to reach
			const result = parseGoldenRow(marketRow(validMarket))

			// WHEN parsed — THEN it is a golden row, with no domain demanded of it
			expect(result).toEqual({
				ok: true,
				value: {
					id: 'es-installations',
					query: 'Empresas instaladoras en España',
					officialDomain: null,
					fields: {},
					market: validMarket,
				},
			})
		})
	})

	describe('when the answer names neither a company nor a market', () => {
		it('should reject it and name a market block as one way to be valid', () => {
			// GIVEN an answer with no domain, no alt domains and no market
			const result = parseGoldenRow(row({ expectedOutput: { fields: {} } }))

			// WHEN parsed
			// THEN it fails loudly, and the reason names every way a row can be valid
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error).toContain('officialDomain')
				expect(result.error).toContain('market')
			}
		})
	})

	describe('when the market block is malformed', () => {
		it.each([
			['not an object', 'a market', 'market must be a JSON object'],
			[
				'missing a name',
				{ ...validMarket, name: undefined },
				'market needs a name',
			],
			['a blank name', { ...validMarket, name: '  ' }, 'market needs a name'],
			[
				'no parts',
				{ ...validMarket, parts: undefined },
				'non-empty parts array',
			],
			['an empty parts array', { ...validMarket, parts: [] }, 'parts array'],
			[
				'a part with no id',
				{ ...validMarket, parts: [{ terms: ['x'] }] },
				'each market part needs an id',
			],
			[
				'a part with no terms',
				{ ...validMarket, parts: [{ id: 'electrical', terms: [] }] },
				'needs a non-empty terms array',
			],
			[
				'a part whose terms are not strings',
				{ ...validMarket, parts: [{ id: 'electrical', terms: [7] }] },
				'needs a non-empty terms array',
			],
			[
				'no notCompanies key',
				{ ...validMarket, notCompanies: undefined },
				'notCompanies',
			],
			[
				'notCompanies that is not a list of names',
				{ ...validMarket, notCompanies: 'FENIE' },
				'notCompanies',
			],
		])('should reject a market with %s', (_case, market, reason) => {
			// GIVEN a market block with something wrong with it
			const result = parseGoldenRow(marketRow(market))

			// WHEN parsed
			// THEN it fails with a reason naming the part at fault. Every market figure
			// divides by something this block states, so a mis-typed key would not make
			// one number wrong in a visible way — it would score a whole market clean
			// for want of anything to check against
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.error).toContain(reason)
		})
	})

	describe('when a market knows of no trade bodies yet', () => {
		it('should accept an empty list, because it has to be stated', () => {
			// GIVEN a market whose bodies nobody has written down
			const result = parseGoldenRow(
				marketRow({ ...validMarket, notCompanies: [] }),
			)

			// WHEN parsed
			// THEN it is accepted. That market scores a perfect organisation-kind
			// precision, and typing the empty list is what makes that a stated "none
			// known" rather than something a forgotten key produced
			expect(result.ok).toBe(true)
			if (result.ok) expect(result.value.market?.notCompanies).toEqual([])
		})
	})

	describe('when a row names both a company and a market', () => {
		it.each([
			['officialDomain', { officialDomain: 'acme.es' }],
			['altDomains', { altDomains: ['librebor.es'] }],
			['fields', { fields: { country: 'ES' } }],
			['contacts', { contacts: ['Ada Lovelace'] }],
		])('should refuse a market row that also carries %s', (key, extra) => {
			// GIVEN a market row that also carries a key which grades a run against one
			// named company
			const result = parseGoldenRow(
				row({ expectedOutput: { market: validMarket, ...extra } }),
			)

			// WHEN parsed
			// THEN it fails, naming the key. Each of these turns a correct "does not
			// apply" into a wrong number: an address makes the scan graded on reaching a
			// company nobody named, so it reports nought grounding, and a country field
			// written beside a market already called ES reports nought field recall.
			// Both read as a pipeline failing rather than as a mistyped row
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.error).toContain(key)
		})
	})
})

describe('parseGoldenSet — the shipped market example', () => {
	describe('when parsing golden-markets.example.json', () => {
		it('should parse every row and cover a language the kind check cannot read', () => {
			// GIVEN the market golden set the eval CLI ships
			const raw = JSON.parse(
				readFileSync(
					new URL(
						'../../../../eval/golden-markets.example.json',
						import.meta.url,
					),
					'utf8',
				),
			) as ReadonlyArray<RawGoldenRow>

			// WHEN parsed
			const result = parseGoldenSet(raw)

			// THEN nothing is rejected, AND the set holds a market answering in a
			// language the shipped organisation-kind check reads and one answering in a
			// language it does not — which is the whole point of a per-market figure.
			// One market alone would report a healthy number and hide the gap
			expect(result.errors).toEqual([])
			const markets = result.golden.map(g => g.market?.name)
			expect(markets).toContain('ES')
			expect(markets).toContain('FR')
			for (const golden of result.golden) {
				expect(golden.market?.parts.length).toBeGreaterThan(0)
				expect(golden.market?.notCompanies.length).toBeGreaterThan(0)
			}
		})
	})
})

describe('parseGoldenRow — a market entry that says nothing', () => {
	const marketWith = (over: Record<string, unknown>): RawGoldenRow =>
		row({
			id: 'es-installations',
			query: 'Empresas instaladoras en España',
			expectedOutput: {
				market: {
					name: 'ES',
					parts: [{ id: 'electrical', terms: ['instalacion electrica'] }],
					notCompanies: ['FENIE'],
					...over,
				},
			},
		})

	describe('when a part carries a blank term', () => {
		it('should refuse it rather than accept a part nothing can answer', () => {
			// GIVEN a term of whitespace, and one of punctuation that survives a blank
			// check yet still folds to nothing the scorer can match on
			const result = parseGoldenRow(
				marketWith({ parts: [{ id: 'solar', terms: ['fotovoltaica', '  '] }] }),
			)
			const punctuation = parseGoldenRow(
				marketWith({ parts: [{ id: 'solar', terms: ['—'] }] }),
			)
			expect(punctuation.ok).toBe(false)

			// WHEN parsed
			// THEN it fails. A blank term can never place a row, so the part would read
			// unanswered for good and the coverage figure would sit low for a reason
			// nobody could see in the numbers
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.error).toContain('no words in it')
		})
	})

	describe('when a known non-company is blank', () => {
		it('should refuse it rather than accept a body nobody named', () => {
			// GIVEN a blank entry, and a punctuation one that folds to nothing
			const result = parseGoldenRow(marketWith({ notCompanies: ['FENIE', ''] }))
			const punctuation = parseGoldenRow(
				marketWith({ notCompanies: ['FENIE', '·'] }),
			)
			expect(punctuation.ok).toBe(false)

			// WHEN parsed
			// THEN it fails. A blank entry matches nothing, so it quietly raises the very
			// figure it was typed in to lower
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.error).toContain('no words in it')
		})
	})
})
