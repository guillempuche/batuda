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
		})
	})
})
