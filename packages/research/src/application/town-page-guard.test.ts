import { describe, expect, it } from 'vitest'

import { placeReadOffATownPage } from './town-page-guard'

const row = (args: {
	name?: string
	website?: string | null
	place?: string | null
	readOn?: string | null
}) => ({
	name: args.name ?? 'Montvalles',
	...(args.website === null
		? {}
		: { website: args.website ?? 'https://montvalles.com/' }),
	...(args.place === null
		? {}
		: {
				location: {
					value: args.place ?? 'Barberà del Vallès, Barcelona',
					confidence: 1,
					...(args.readOn === null
						? {}
						: {
								source_id:
									args.readOn ??
									'https://montvalles.com/estructuras-metalicas-barbera-del-valles/',
							}),
				},
			}),
})

describe('placeReadOffATownPage', () => {
	describe('when the place was read off a page the firm filed under that town', () => {
		it('should refuse it, since the page says where the firm will go', () => {
			// GIVEN a landing page on the firm's own site, named for the town
			// WHEN the place is read against it
			const reading = placeReadOffATownPage(row({}))
			// THEN the town is refused, and the reader is told what was read
			expect(reading).toEqual({
				host: 'montvalles.com',
				place: 'barberadelvalles',
				filedAs: 'estructuras-metalicas-barbera-del-valles',
			})
		})

		it('should read the place the row leads with, not the ones around it', () => {
			// GIVEN a location that leads with its province instead of its town —
			// the other way round from how a location is normally written
			// WHEN read against a page filed under the town
			// THEN nothing is refused. This is a catch given up on purpose: reading
			// the wider places too is what lets a page named for the province take
			// a correct town off the row, and that costs more than this misses
			expect(
				placeReadOffATownPage(
					row({ place: 'Barcelona, Barberà del Vallès, España' }),
				),
			).toBeNull()
		})

		it('should read a town spelled without its accents in the path', () => {
			// GIVEN a path that folds "Barberà" to "barbera", as a path must
			// WHEN read — THEN the two are the same town
			expect(placeReadOffATownPage(row({}))?.place).toBe('barberadelvalles')
		})
	})

	describe("when the page is not the firm's own", () => {
		it('should leave it alone, since a directory files a company where it is', () => {
			// GIVEN a place read off a business directory's page for that town
			// WHEN read against the firm's own site
			// THEN nothing is refused — this is how a directory states a place
			expect(
				placeReadOffATownPage(
					row({
						name: 'Fadiplast S.L.',
						website: 'https://fadiplast.com',
						place: 'Montcada i Reixac, Barcelona',
						readOn:
							'https://empresite.eleconomista.es/montcada-reixac-barcelona',
					}),
				),
			).toBeNull()
		})
	})

	describe('when the path carries nothing but the town', () => {
		it('should leave it alone, since that is an index of a town', () => {
			// GIVEN the firm's own site with a bare town path
			// WHEN read — THEN a page that says only the town is not a page about it
			expect(
				placeReadOffATownPage(
					row({ readOn: 'https://montvalles.com/barbera-del-valles' }),
				),
			).toBeNull()
		})
	})

	describe("when the town is part of the company's own name", () => {
		it('should leave it alone, since the path is spelling the name', () => {
			// GIVEN a firm whose own name carries the town
			// WHEN its site files a page under that name
			// THEN the path names the company, not a town it travels to
			expect(
				placeReadOffATownPage(
					row({
						name: 'SA RUBI INDUSTRIAL',
						website: 'https://suppliers.catalonia.com',
						place: 'Rubí, Barcelona',
						readOn: 'https://suppliers.catalonia.com/sa-rubi-industrial',
					}),
				),
			).toBeNull()
		})
	})

	describe('when the path names the province the location also states', () => {
		it('should leave it alone, or the correct town goes with it', () => {
			// GIVEN a firm genuinely in Rubí, whose own site has an ordinary page
			// named for the province rather than for a town
			// WHEN read against the place it claims
			// THEN nothing is refused: a page filed under the province says nothing
			// about which of its towns the firm sits in, and refusing here would
			// take "Rubí" away too
			expect(
				placeReadOffATownPage(
					row({
						name: 'Firma Industrial SL',
						website: 'https://firma.example',
						place: 'Rubí, Barcelona',
						readOn: 'https://firma.example/serveis-barcelona',
					}),
				),
			).toBeNull()
		})

		it('should still refuse when the page names the town itself', () => {
			// GIVEN the same firm and the same location, but a page written about
			// the town the row claims
			// WHEN read — THEN that is the shape this exists for
			expect(
				placeReadOffATownPage(
					row({
						name: 'Firma Industrial SL',
						website: 'https://firma.example',
						place: 'Rubí, Barcelona',
						readOn: 'https://firma.example/serralleria-rubi',
					}),
				)?.place,
			).toBe('rubi')
		})
	})

	describe('when a town of several words is part of the name', () => {
		it('should read the name a run of words at a time, as it reads a path', () => {
			// GIVEN a firm named after the town it is in, written as three words —
			// which is how nearly every town around here is written
			// WHEN its own site files a page under that name
			// THEN the path is spelling the company, not filing it under a town
			expect(
				placeReadOffATownPage(
					row({
						name: 'Estructures Castellar del Vallès',
						website: 'https://estructures-castellar.example',
						place: 'Castellar del Vallès, Barcelona',
						readOn:
							'https://estructures-castellar.example/estructures-castellar-del-valles',
					}),
				),
			).toBeNull()
		})
	})

	describe('when the row cannot be graded', () => {
		it('should leave alone a location written without the page it was read on', () => {
			// GIVEN findings stored before the field was paired with its source
			// WHEN read — THEN there is nothing to grade the place against
			expect(placeReadOffATownPage(row({ readOn: null }))).toBeNull()
			expect(
				placeReadOffATownPage({
					name: 'Montvalles',
					website: 'https://montvalles.com/',
					location: 'Barberà del Vallès, Barcelona',
				}),
			).toBeNull()
		})

		it('should leave alone a row with no website to establish its own site', () => {
			// GIVEN a row that never stated a website
			// WHEN read — THEN nothing says the page belongs to the firm
			expect(placeReadOffATownPage(row({ website: null }))).toBeNull()
		})

		it('should leave alone a row that states no place', () => {
			// GIVEN a row with no location at all
			// WHEN read — THEN there is no place to refuse
			expect(placeReadOffATownPage(row({ place: null }))).toBeNull()
			expect(placeReadOffATownPage(row({ place: '   ' }))).toBeNull()
		})

		it('should leave alone a source that is not a readable web address', () => {
			// GIVEN a source id a page supplied that does not parse as an address
			// WHEN read — THEN no host can be established, so nothing is refused
			expect(
				placeReadOffATownPage(row({ readOn: 'not an address' })),
			).toBeNull()
			expect(
				placeReadOffATownPage(row({ readOn: 'https://montvalles.com' })),
			).toBeNull()
		})

		it('should leave alone a place too short to be read against a path', () => {
			// GIVEN a two-letter place, which matches far too easily
			// WHEN read — THEN it is below the floor and nothing is refused
			expect(
				placeReadOffATownPage(
					row({ place: 'BV', readOn: 'https://montvalles.com/taller-bv' }),
				),
			).toBeNull()
		})
	})
})
