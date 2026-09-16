import { describe, expect, it } from 'vitest'

import type { ResearchAttributeDeclaration } from '@batuda/domain'

import { guardAttributes } from './attribute-guard'

const SITES: ResearchAttributeDeclaration = {
	key: 'site_count',
	label: 'Sites',
	kind: 'number',
	enumValues: null,
	unit: 'sites',
	description: null,
}
const BOOKINGS: ResearchAttributeDeclaration = {
	key: 'takes_bookings',
	label: 'Takes online bookings',
	kind: 'boolean',
	enumValues: null,
	unit: null,
	description: null,
}

const PAGE = 'https://acme.example/about'
const CORPUS =
	'acme trades from 12 premises across catalonia. bookings open online since 2020. founded in 2020.'

const value = (raw: unknown, quote: string): Record<string, unknown> => ({
	value: raw,
	source_id: PAGE,
	quote,
	confidence: null,
})

const attributesOf = (findings: unknown): Record<string, unknown> | undefined =>
	(findings as { attributes?: Record<string, unknown> }).attributes

describe('guardAttributes, when the quote is not the page’s own words', () => {
	describe('when the quote is a remark the model wrote about the page', () => {
		it('should drop the value rather than store "not stated" as a fact', () => {
			// GIVEN a yes/no written as false with the model's own remark for a
			// quote, and a number whose quote sums the page up in the model's words
			const findings = {
				attributes: {
					takes_bookings: value(
						false,
						'no se indica si acepta reservas online',
					),
					site_count: value(
						70,
						'the page lists more than 70 premises across the region',
					),
				},
			}

			// WHEN graded against a page that holds most of those words, not those lines
			const result = guardAttributes(
				findings,
				`${CORPUS} reservas online y 70 premises en la region.`,
				[BOOKINGS, SITES],
				'company_enrichment_v1',
			)

			// THEN both go as unsupported
			expect(attributesOf(result.findings)).toBeUndefined()
			expect(result.drops.map(d => d.reason)).toEqual([
				'unsupported',
				'unsupported',
			])
		})
	})

	describe('when the quote skips part of the page with an ellipsis', () => {
		it('should keep the value when each part it keeps is on the page', () => {
			// GIVEN a quote made of two runs of the page joined by an ellipsis
			const findings = {
				attributes: {
					site_count: value(12, 'trades from 12 premises … founded in 2020'),
				},
			}

			// WHEN graded
			const result = guardAttributes(
				findings,
				CORPUS,
				[SITES],
				'company_enrichment_v1',
			)

			// THEN it stands
			expect(attributesOf(result.findings)?.['site_count']).toMatchObject({
				value: 12,
			})
		})
	})

	describe('when the quote differs from the page only in markdown and punctuation', () => {
		it('should still read it as the page’s words', () => {
			// GIVEN a quote copied from a page whose markdown bolded the number
			const findings = {
				attributes: {
					site_count: value(
						12,
						'trades from **12** premises, across Catalonia!',
					),
				},
			}

			// WHEN graded
			const result = guardAttributes(
				findings,
				CORPUS,
				[SITES],
				'company_enrichment_v1',
			)

			// THEN it stands
			expect(attributesOf(result.findings)?.['site_count']).toMatchObject({
				value: 12,
			})
		})
	})
})
