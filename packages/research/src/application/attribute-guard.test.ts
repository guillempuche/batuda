import { describe, expect, it } from 'vitest'

import type { ResearchAttributeDeclaration } from '@batuda/domain'

import { guardAttributes } from './attribute-guard'

const SITES: ResearchAttributeDeclaration = {
	key: 'site_count',
	label: 'Sites',
	kind: 'number',
	enumValues: null,
	unit: 'sites',
	description: 'How many premises the business trades from.',
}
const FIT: ResearchAttributeDeclaration = {
	key: 'fit',
	label: 'Fit',
	kind: 'enum',
	enumValues: ['strong', 'no'],
	unit: null,
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
const FOUNDED: ResearchAttributeDeclaration = {
	key: 'founded_on',
	label: 'Founded on',
	kind: 'date',
	enumValues: null,
	unit: null,
	description: null,
}
const TOOLS: ResearchAttributeDeclaration = {
	key: 'current_tools',
	label: 'Current tools',
	kind: 'text',
	enumValues: null,
	unit: null,
	description: null,
}

const PAGE = 'https://acme.example/about'
const CORPUS =
	'acme trades from 12 premises across catalonia. bookings open online since 2020. we run our workshop on odoo. a strong fit for us. founded in 2020.'

const value = (
	raw: unknown,
	quote: string,
	source_id: string = PAGE,
): Record<string, unknown> => ({
	value: raw,
	source_id,
	quote,
	confidence: null,
})

const attributesOf = (findings: unknown): Record<string, unknown> | undefined =>
	(findings as { attributes?: Record<string, unknown> }).attributes

describe('guardAttributes', () => {
	describe('when every value is declared, cited, quoted and reads as its kind', () => {
		it('should keep each one as the typed value its kind reads', () => {
			// GIVEN a number, a choice in capitals, a yes, a date and a text, each
			// quoted from the page
			const findings = {
				attributes: {
					site_count: value('12', 'trades from 12 premises'),
					fit: value('Strong', 'a strong fit for us'),
					takes_bookings: value('yes', 'bookings open online'),
					founded_on: value('2020-01-01', 'founded in 2020'),
					current_tools: value('Odoo', 'we run our workshop on odoo'),
				},
			}

			// WHEN graded against the evidence
			const result = guardAttributes(
				findings,
				CORPUS,
				[SITES, FIT, BOOKINGS, FOUNDED, TOOLS],
				'company_enrichment_v1',
			)

			// THEN each survives as the value its kind reads, citation kept
			expect(attributesOf(result.findings)).toEqual({
				site_count: value(12, 'trades from 12 premises'),
				fit: value('strong', 'a strong fit for us'),
				takes_bookings: value(true, 'bookings open online'),
				founded_on: value('2020-01-01', 'founded in 2020'),
				current_tools: value('Odoo', 'we run our workshop on odoo'),
			})
			expect(result.kept).toBe(5)
			expect(result.drops).toEqual([])
		})
	})

	describe('when a value fails one of the checks', () => {
		it('should drop it for that reason and keep the others', () => {
			// GIVEN one value per way of failing
			const findings = {
				attributes: {
					nobody_declared: value('3', 'trades from 12 premises'),
					site_count: value('12', 'trades from 12 premises', ''),
					fit: value('strong', ''),
					takes_bookings: value('yes', 'words the page never says'),
					founded_on: value(
						'2020-01-01',
						'founded in 2020',
						'https://www.linkedin.com/in/somebody',
					),
					current_tools: value('unknown', 'we run our workshop on odoo'),
				},
			}

			// WHEN graded
			const result = guardAttributes(
				findings,
				CORPUS,
				[SITES, FIT, BOOKINGS, FOUNDED, TOOLS],
				'company_enrichment_v1',
			)

			// THEN nothing survives and every reason is named
			expect(attributesOf(result.findings)).toBeUndefined()
			expect(result.kept).toBe(0)
			expect(result.drops).toEqual([
				{ key: 'nobody_declared', reason: 'undeclared' },
				{ key: 'site_count', reason: 'ungrounded' },
				{ key: 'fit', reason: 'unquoted' },
				{ key: 'takes_bookings', reason: 'unsupported' },
				{ key: 'founded_on', reason: 'off_entity' },
				{ key: 'current_tools', reason: 'wrong_kind' },
			])
		})
	})

	describe('when a value does not read as its kind, or the quote does not carry it', () => {
		it('should drop a number the quote does not state, a date whose year the quote lacks, and a choice off the list', () => {
			// GIVEN 12 quoted from a year, 2020 quoted without the year, a choice
			// nobody declared, and a number written as words
			const findings = {
				attributes: {
					site_count: value('12', 'founded in 2020'),
					founded_on: value('2020-01-01', 'trades from 12 premises'),
					fit: value('gigantic', 'a strong fit for us'),
					takes_bookings: value('perhaps', 'bookings open online'),
				},
			}

			// WHEN graded
			const result = guardAttributes(
				findings,
				CORPUS,
				[SITES, FIT, BOOKINGS, FOUNDED],
				'company_enrichment_v1',
			)

			// THEN each is the wrong kind
			expect(result.drops.map(drop => drop.reason)).toEqual([
				'wrong_kind',
				'wrong_kind',
				'wrong_kind',
				'wrong_kind',
			])
		})
	})

	describe('when a text value is an acronym', () => {
		it('should keep it only when the quote writes it, never on the benefit of the doubt', () => {
			// GIVEN "SAP" quoted from words about another product, and from words naming it
			const dropped = guardAttributes(
				{
					attributes: {
						current_tools: value('SAP', 'we run our workshop on odoo'),
					},
				},
				CORPUS,
				[TOOLS],
				'company_enrichment_v1',
			)
			const kept = guardAttributes(
				{
					attributes: {
						current_tools: value('SAP', 'we run our stock on sap'),
					},
				},
				'we run our stock on sap',
				[TOOLS],
				'company_enrichment_v1',
			)

			// THEN only the quoted one stands
			expect(dropped.drops).toEqual([
				{ key: 'current_tools', reason: 'wrong_kind' },
			])
			expect(kept.kept).toBe(1)
		})
	})

	describe('when a number has a fraction', () => {
		it('should keep it when the quote writes the decimal', () => {
			// GIVEN 12.5 quoted as a decimal
			const result = guardAttributes(
				{
					attributes: {
						site_count: value('12.5', 'about 12.5 sites on average'),
					},
				},
				'about 12.5 sites on average',
				[SITES],
				'company_enrichment_v1',
			)

			// THEN it stands as the number
			expect(attributesOf(result.findings)?.['site_count']).toEqual(
				value(12.5, 'about 12.5 sites on average'),
			)
		})
	})

	describe('when the cited page reads as another company', () => {
		it('should drop the value as off entity', () => {
			// GIVEN a check that says the page is somebody else's
			const findings = {
				attributes: { site_count: value('12', 'trades from 12 premises') },
			}

			// WHEN graded with that check
			const result = guardAttributes(
				findings,
				CORPUS,
				[SITES],
				'company_enrichment_v1',
				() => true,
			)

			// THEN the value goes
			expect(result.drops).toEqual([
				{ key: 'site_count', reason: 'off_entity' },
			])
		})
	})

	describe('when nothing is declared for the run', () => {
		it('should strip whatever the model wrote, naming each key', () => {
			// GIVEN values under keys no declaration covers
			const findings = {
				enrichment: {},
				attributes: { a: value('1', 'x'), b: value('2', 'y') },
			}

			// WHEN graded with no declarations
			const result = guardAttributes(findings, '', [], 'company_enrichment_v1')

			// THEN the map is gone and both keys are undeclared
			expect(result.findings).toEqual({ enrichment: {} })
			expect(result.drops.map(drop => drop.key)).toEqual(['a', 'b'])
		})
	})

	describe('when there is no evidence to hold the quote to', () => {
		it('should still hold the value to its kind', () => {
			// GIVEN an empty corpus and a number the quote states
			const findings = {
				attributes: { site_count: value('12', 'trades from 12 premises') },
			}

			// WHEN graded without a corpus
			const result = guardAttributes(
				findings,
				'',
				[SITES],
				'company_enrichment_v1',
			)

			// THEN it is kept, typed
			expect(attributesOf(result.findings)?.['site_count']).toEqual(
				value(12, 'trades from 12 premises'),
			)
		})
	})

	describe('when the map is not a map, or there is none', () => {
		it('should drop a non-map and leave findings without one untouched', () => {
			// GIVEN a string where the map should be, and findings with none
			const text = guardAttributes(
				{ attributes: 'x' },
				'',
				[SITES],
				'company_enrichment_v1',
			)
			const none = { enrichment: {} }

			// THEN the string goes as ungrounded and the other is the same object
			expect(text.findings).toEqual({})
			expect(text.drops).toEqual([{ key: '', reason: 'ungrounded' }])
			expect(
				guardAttributes(none, '', [SITES], 'company_enrichment_v1').findings,
			).toBe(none)
			expect(
				guardAttributes('x', '', [SITES], 'company_enrichment_v1').findings,
			).toBe('x')
		})
	})

	describe('when a scan carries a map on each company', () => {
		it('should grade each row on its own and count what every row kept', () => {
			// GIVEN one row with a good value, one with a bad one, one with none
			const findings = {
				prospects: [
					{
						name: 'A',
						attributes: { site_count: value('12', 'trades from 12 premises') },
					},
					{
						name: 'B',
						attributes: {
							site_count: value('many', 'trades from 12 premises'),
						},
					},
					{ name: 'C' },
				],
			}

			// WHEN graded
			const result = guardAttributes(
				findings,
				CORPUS,
				[SITES],
				'prospect_scan_v1',
			)

			// THEN A keeps its typed value, B loses its map, C is untouched
			const rows = (
				result.findings as { prospects: Array<Record<string, unknown>> }
			).prospects
			expect(rows[0]?.['attributes']).toEqual({
				site_count: value(12, 'trades from 12 premises'),
			})
			expect(rows[1]).toEqual({ name: 'B' })
			expect(rows[2]).toBe(findings.prospects[2])
			expect(result.kept).toBe(1)
			expect(result.drops).toEqual([
				{ key: 'site_count', reason: 'wrong_kind' },
			])
		})
	})
})
