import { describe, expect, it } from 'vitest'

import { listUseOf } from './eval-list-use'
import type { MarketExpectation, RunOutcome } from './eval-scoring-types'

const row = (
	over: Partial<RunOutcome['companies'][number]> & { name: string },
): RunOutcome['companies'][number] => ({
	website: null,
	location: null,
	describedAs: '',
	confirmed: false,
	headcount: null,
	...over,
})

const outcomeOf = (
	companies: RunOutcome['companies'],
	over: Partial<RunOutcome> = {},
): RunOutcome => ({
	status: 'succeeded',
	reachedDomains: [],
	fields: {},
	contacts: [],
	companies,
	removed: [],
	searchingStopped: null,
	reportedCoverage: null,
	searching: { rounds: null, gapRounds: null },
	searches: null,
	people: { named: 0, titled: 0 },
	...over,
})

const market = (over: Partial<MarketExpectation> = {}): MarketExpectation => ({
	name: 'ES-GI',
	parts: [{ id: 'electrical', terms: ['instalacion electrica'] }],
	notCompanies: [],
	...over,
})

describe('listUseOf', () => {
	describe('when rows carry a web address', () => {
		it("should count the firm's own site and not a page about it on a social platform", () => {
			// GIVEN a row with its own site, one with a social page, one with none
			// and one whose address is not an address
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Vall', website: 'https://www.vall.example/contacte' }),
					row({ name: 'Besòs', website: 'https://www.facebook.com/besos' }),
					row({ name: 'Tubs' }),
					row({ name: 'Ter', website: 'pendent' }),
				]),
				market(),
			)

			// THEN only the first is a way to reach the firm
			expect(use.rowsWithWebsite).toBe(1)
		})
	})

	describe('when rows state a headcount', () => {
		it('should count them, nought included', () => {
			// GIVEN a row with a headcount, one with nought, one with none
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Vall', headcount: 12 }),
					row({ name: 'Besòs', headcount: 0 }),
					row({ name: 'Tubs' }),
				]),
				market(),
			)

			// THEN a stated nought is still a stated headcount
			expect(use.rowsWithHeadcount).toBe(2)
		})
	})

	describe('when the golden row writes down the asked place', () => {
		it('should count the rows whose place says more than the request did', () => {
			// GIVEN the province of Girona asked for, with its names and what is
			// wider than it
			const asked = market({
				placeWords: ['Girona', 'Gerona', 'provincia', 'Catalunya', 'España'],
			})
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Vall', location: 'Banyoles, Girona' }),
					row({ name: 'Besòs', location: 'C/ Ter 15, 17003 Girona' }),
					row({ name: 'Tubs', location: 'Girona, España' }),
					row({ name: 'Ter', location: 'Província de Girona' }),
					row({ name: 'Onyar' }),
				]),
				asked,
			)

			// THEN a town and a street address narrow it; the province said again,
			// accents or not, and no place at all do not
			expect(use.rowsPlacedNarrower).toBe(2)
		})
	})

	describe('when the golden row writes down no place words', () => {
		it('should not try to tell narrowing from repeating', () => {
			// GIVEN a located row and a market without place words
			const use = listUseOf(
				outcomeOf([row({ name: 'Vall', location: 'Banyoles, Girona' })]),
				market(),
			)

			// THEN the figure is absent rather than nought
			expect(use.rowsPlacedNarrower).toBeNull()
		})
	})

	describe('when the golden row names firms known to exist', () => {
		it('should find a firm by its own site or by its name, and name the ones missed', () => {
			// GIVEN four known firms: one listed under another spelling but its own
			// site, one listed by name with no site, one with no site listed by its
			// legal form, and one not listed at all
			const known = market({
				knownCompanies: [
					{ name: 'Valentí Serveis', host: 'valenti.example', from: 'search' },
					{ name: 'Electer', host: 'electer.example', from: 'search' },
					{ name: 'Tallers Bergé', host: null, from: 'guild list' },
					{ name: 'Instal Rivas', host: 'instalrivas.example', from: 'search' },
				],
			})
			const use = listUseOf(
				outcomeOf([
					row({
						name: 'Valentí Serveis i Instal·lacions SL',
						website: 'https://www.valenti.example/',
					}),
					row({ name: 'ELECTER' }),
					row({ name: 'Tallers Bergé, S.L.' }),
					row({ name: 'Another Firm', website: 'https://another.example' }),
				]),
				known,
			)

			// THEN three are found and the fourth is named as missed
			expect(use.knownFound).toEqual([
				'Valentí Serveis',
				'Electer',
				'Tallers Bergé',
			])
			expect(use.knownMissed).toEqual(['Instal Rivas'])
		})

		it('should not find a firm on a social page that shares nothing but the platform', () => {
			// GIVEN a known firm whose host is a social platform's, and a row on it
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Besòs', website: 'https://facebook.com/besos' }),
				]),
				market({
					knownCompanies: [
						{ name: 'Vall', host: 'facebook.com', from: 'search' },
					],
				}),
			)

			// THEN sharing the platform is not being the firm
			expect(use.knownMissed).toEqual(['Vall'])
		})
	})

	describe('when the golden row names no known firms', () => {
		it('should report none found and none missed', () => {
			const use = listUseOf(outcomeOf([row({ name: 'Vall' })]), market())
			expect(use.knownFound).toEqual([])
			expect(use.knownMissed).toEqual([])
		})
	})

	describe('when a row sits in a town named like the asked place', () => {
		it('should read it as the request said again, since the two cannot be told apart', () => {
			// GIVEN a market asked by province, a row in the capital of the same
			// name, and a row in another town of it
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Instal Alfa', location: 'Girona' }),
					row({ name: 'Instal Beta', location: 'Banyoles, Girona' }),
				]),
				market({ placeWords: ['Girona', 'provincia de Girona'] }),
			)

			// THEN only the second says more than the request did
			expect(use.rowsPlacedNarrower).toBe(1)
		})
	})

	describe('when several rows give one host as their website', () => {
		it('should read a host three different firms share as a listing, and nobody’s own site', () => {
			// GIVEN three differently-named rows on one listing host, and one firm
			// on a site of its own
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Instal Alfa', website: 'https://llistat.example/alfa' }),
					row({ name: 'Instal Beta', website: 'https://llistat.example/beta' }),
					row({
						name: 'Instal Gamma',
						website: 'https://www.llistat.example/gamma',
					}),
					row({ name: 'Instal Delta', website: 'https://delta.example' }),
				]),
				market(),
			)

			// THEN only the last has a site of its own
			expect(use.rowsWithWebsite).toBe(1)
		})

		it('should leave two rows sharing a host alone, and one firm written three ways', () => {
			// GIVEN a parent and its branch on one host, and one firm written three
			// times with and without its legal form
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Grup Omega', website: 'https://omega.example' }),
					row({
						name: 'Omega Girona',
						website: 'https://omega.example/girona',
					}),
					row({ name: 'Sigma, S.L.', website: 'https://sigma.example' }),
					row({ name: 'Sigma SL', website: 'https://sigma.example/contacte' }),
					row({ name: 'Sigma', website: 'https://www.sigma.example' }),
				]),
				market(),
			)

			// THEN every one of them is on its own site
			expect(use.rowsWithWebsite).toBe(5)
		})

		it('should read one firm under three names of its own as a listing, which is the rule’s cost', () => {
			// GIVEN a parent and two branches, each named differently, on the firm's host
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Grup Omega', website: 'https://omega.example' }),
					row({
						name: 'Omega Girona',
						website: 'https://omega.example/girona',
					}),
					row({
						name: 'Omega Figueres',
						website: 'https://omega.example/figueres',
					}),
				]),
				market(),
			)

			// THEN none of the three counts, though the site is the firm's own
			expect(use.rowsWithWebsite).toBe(0)
		})

		it('should not find a known firm by a host the list uses as a listing', () => {
			// GIVEN a golden row that, by mistake, gives a listing as a firm's host
			const use = listUseOf(
				outcomeOf([
					row({ name: 'Instal Alfa', website: 'https://llistat.example/alfa' }),
					row({ name: 'Instal Beta', website: 'https://llistat.example/beta' }),
					row({
						name: 'Instal Gamma',
						website: 'https://llistat.example/gamma',
					}),
				]),
				market({
					knownCompanies: [
						{ name: 'Instal Zeta', host: 'llistat.example', from: 'search' },
					],
				}),
			)

			// THEN three rows on that host do not make the firm found
			expect(use.knownMissed).toEqual(['Instal Zeta'])
		})
	})

	describe('when the scan came back with nothing', () => {
		it('should count nought everywhere and miss every known firm', () => {
			const use = listUseOf(
				outcomeOf([]),
				market({
					placeWords: ['Girona'],
					knownCompanies: [{ name: 'Vall', host: null, from: 'search' }],
				}),
			)
			expect(use).toEqual({
				rowsWithWebsite: 0,
				rowsWithHeadcount: 0,
				rowsPlacedNarrower: 0,
				knownFound: [],
				knownMissed: ['Vall'],
			})
		})
	})
})
