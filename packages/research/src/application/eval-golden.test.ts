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
