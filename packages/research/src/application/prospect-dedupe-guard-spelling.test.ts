import { describe, expect, it } from 'vitest'

import { dedupeDiscoveryRows, nearlyTheSameName } from './prospect-dedupe-guard'
import { runWordsOf } from './run-words'

const runWords = runWordsOf([])
const names = (findings: unknown): ReadonlyArray<string> =>
	(findings as { prospects: Array<{ name: string }> }).prospects.map(
		row => row.name,
	)

describe('nearlyTheSameName, over two spellings of one company', () => {
	it('should read a few letters of difference in a long name as one name', () => {
		// GIVEN the Spanish and the Catalan spelling of one company
		expect(
			nearlyTheSameName(
				'Decolletaje Sabadell, S.L.',
				'Decoletatge Sabadell S.L.',
			),
		).toBe(true)
		// AND the same name with its legal form off
		expect(nearlyTheSameName('Acme Logistics SL', 'Acme Logistics')).toBe(true)
		// AND one of them shouted in capitals
		expect(
			nearlyTheSameName('DECOLLETAJE SABADELL, S.L.', 'decoletatge sabadell'),
		).toBe(true)
	})

	it('should keep two different companies apart', () => {
		// GIVEN names a few letters apart that are short, or far apart
		expect(nearlyTheSameName('Acme Solar', 'Acme Sonar')).toBe(false)
		expect(
			nearlyTheSameName('Instalaciones Pérez', 'Instalaciones Gómez'),
		).toBe(false)
		expect(nearlyTheSameName('', 'Acme')).toBe(false)
		// AND a name carrying a word the other does not
		expect(
			nearlyTheSameName(
				'Decolletaje Sabadell Barcelona',
				'Decoletatge Sabadell',
			),
		).toBe(false)
	})
})

describe('dedupeDiscoveryRows, when one company is written in two languages on one site', () => {
	it('should fold the rows the domain spells for neither', () => {
		// GIVEN the two spellings, both at decolletatgesabadell.com, and a third
		// company on its own site
		const findings = {
			prospects: [
				{
					name: 'Decolletaje Sabadell, S.L.',
					website: 'https://decolletatgesabadell.com/',
					citations: [
						{ source_id: 'https://decolletatgesabadell.com/es/quienes-somos/' },
					],
				},
				{
					name: 'Decoletaje 9002',
					website: 'https://decoletaje9002.com/',
					citations: [],
				},
				{
					name: 'Decoletatge Sabadell S.L.',
					website: 'https://decolletatgesabadell.com/',
					citations: [{ source_id: 'https://decolletatgesabadell.com/' }],
					employee_estimate: 23,
				},
			],
		}
		// WHEN folded
		const result = dedupeDiscoveryRows(findings, 'prospects', runWords)
		// THEN the first spelling stays with the later row's headcount, one row merged
		expect(names(result.findings)).toEqual([
			'Decolletaje Sabadell, S.L.',
			'Decoletaje 9002',
		])
		expect(result.merged).toBe(1)
		expect(
			(result.findings as { prospects: Array<{ employee_estimate?: number }> })
				.prospects[0]?.employee_estimate,
		).toBe(23)
	})

	it('should leave the two spellings apart when neither names a site', () => {
		// GIVEN the same two spellings with no website between them
		const findings = {
			prospects: [
				{ name: 'Decolletaje Sabadell, S.L.', citations: [] },
				{ name: 'Decoletatge Sabadell S.L.', citations: [] },
			],
		}
		// WHEN folded
		const result = dedupeDiscoveryRows(findings, 'prospects', runWords)
		// THEN both stay: a shared site is what makes a spelling slip one company
		expect(result.merged).toBe(0)
		expect(names(result.findings)).toHaveLength(2)
	})

	it('should leave two companies on a shared platform host apart', () => {
		// GIVEN two near-named rows whose "site" is a social platform
		const findings = {
			prospects: [
				{
					name: 'Acme Logistics',
					website: 'https://facebook.com/acmelog',
					citations: [],
				},
				{
					name: 'Acme Logistica',
					website: 'https://facebook.com/acmelogistica',
					citations: [],
				},
			],
		}
		// WHEN folded
		const result = dedupeDiscoveryRows(findings, 'prospects', runWords)
		// THEN both stay
		expect(result.merged).toBe(0)
	})
})
