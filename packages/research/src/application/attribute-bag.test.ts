import { describe, expect, it } from 'vitest'

import { foldAttributeEntries } from './attribute-bag'

const entry = (key: string, value = '3') => ({
	key,
	value,
	source_id: 'https://acme.example/about',
	quote: 'three sites',
})

describe('foldAttributeEntries', () => {
	describe('when a company profile carries a list of entries', () => {
		it('should turn it into a map keyed by attribute, each value paired with its page', () => {
			// GIVEN two entries, one with a key that needs trimming
			const findings = {
				enrichment: { industry: { value: 'x' } },
				attributes: [entry('site_count'), entry(' fit ', 'strong')],
			}

			// WHEN folded
			const result = foldAttributeEntries(findings, 'company_enrichment_v1')

			// THEN each key holds the pairing every other sourced field uses, and
			// the rest of the findings are untouched
			expect(result.findings).toEqual({
				enrichment: { industry: { value: 'x' } },
				attributes: {
					site_count: {
						value: '3',
						source_id: 'https://acme.example/about',
						quote: 'three sites',
						confidence: null,
					},
					fit: {
						value: 'strong',
						source_id: 'https://acme.example/about',
						quote: 'three sites',
						confidence: null,
					},
				},
			})
			expect(result.folded).toBe(2)
			expect(result.dropped).toBe(0)
		})
	})

	describe('when the list repeats a key or names none', () => {
		it('should keep the first entry per key and count the rest as dropped', () => {
			// GIVEN a repeat, an entry with no key, one with a blank key, and a non-object
			const findings = {
				attributes: [
					entry('site_count', '3'),
					entry('site_count', '9'),
					{ value: '1', source_id: 's', quote: 'q' },
					entry('  ', '1'),
					'nonsense',
				],
			}

			// WHEN folded
			const result = foldAttributeEntries(findings, 'company_enrichment_v1')

			// THEN the first reading stands and the others are counted
			expect(
				(result.findings as { attributes: Record<string, { value: string }> })
					.attributes['site_count']?.value,
			).toBe('3')
			expect(result.folded).toBe(1)
			expect(result.dropped).toBe(4)
		})
	})

	describe('when the list is empty, or the field is not a list', () => {
		it('should take the field off, so an empty map never reads as declared', () => {
			// GIVEN an empty list and a string where the list should be
			const empty = foldAttributeEntries(
				{ attributes: [] },
				'company_enrichment_v1',
			)
			const text = foldAttributeEntries(
				{ attributes: 'none' },
				'company_enrichment_v1',
			)

			// THEN neither keeps the field
			expect(empty.findings).toEqual({})
			expect(empty.dropped).toBe(0)
			expect(text.findings).toEqual({})
			expect(text.dropped).toBe(1)
		})
	})

	describe('when the field is already a map, or absent', () => {
		it('should hand the findings back untouched', () => {
			// GIVEN a settled map and findings with no attributes at all
			const settled = { attributes: { site_count: { value: 3 } } }
			const none = { enrichment: {} }

			// THEN the same object comes back
			expect(
				foldAttributeEntries(settled, 'company_enrichment_v1').findings,
			).toBe(settled)
			expect(foldAttributeEntries(none, 'company_enrichment_v1').findings).toBe(
				none,
			)
			expect(foldAttributeEntries('x', 'company_enrichment_v1').findings).toBe(
				'x',
			)
		})
	})

	describe('when a scan carries entries on each company', () => {
		it('should fold each row on its own and leave rows without any alone', () => {
			// GIVEN two rows with entries, one without, and one that is not a row
			const findings = {
				prospects: [
					{ name: 'A', attributes: [entry('site_count')] },
					{ name: 'B' },
					{ name: 'C', attributes: [] },
					'not a row',
				],
			}

			// WHEN folded
			const result = foldAttributeEntries(findings, 'prospect_scan_v1')

			// THEN A holds a map, B is the same object, C lost its empty list
			const rows = (result.findings as { prospects: Array<unknown> }).prospects
			expect(rows[0]).toEqual({
				name: 'A',
				attributes: {
					site_count: {
						value: '3',
						source_id: 'https://acme.example/about',
						quote: 'three sites',
						confidence: null,
					},
				},
			})
			expect(rows[1]).toBe(findings.prospects[1])
			expect(rows[2]).toEqual({ name: 'C' })
			expect(rows[3]).toBe('not a row')
			expect(result.folded).toBe(1)
		})

		it('should hand a scan with no list back untouched', () => {
			const findings = { market_summary: 'x' }
			expect(foldAttributeEntries(findings, 'prospect_scan_v1').findings).toBe(
				findings,
			)
		})
	})
})
