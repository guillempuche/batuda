import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import type { Company } from '@batuda/domain'

import { CompanyService } from './companies'
import { geocodeCompany, locationWasReplaced } from './company-geocoding'
import { GeocodeLookupError, type GeocodeResult, Geocoder } from './geocoder'

const unused = new Error('method not used in this test')
const currentOrg = { id: 'org-1', name: 'fixture', slug: 'fixture' }

// A CompanyService whose findById returns the given row and whose update
// records the fields it was asked to write, so the test can inspect them.
// The other methods are never reached here.
const companyServiceWith = (
	company: Record<string, unknown> | null,
	updates: Array<Record<string, unknown>>,
) =>
	// Fixtures stand in for a decoded Company; the test only exercises
	// geocodeCompany's location read + captured update fields.
	CompanyService.of({
		findById: () =>
			company === null
				? Effect.die(new Error('company not found'))
				: Effect.succeed(company as unknown as Company),
		update: (_id: string, data: Record<string, unknown>) =>
			Effect.sync(() => {
				updates.push(data)
				return [{ ...company, ...data }] as unknown as ReadonlyArray<Company>
			}),
		search: () => Effect.die(unused),
		findBySlug: () => Effect.die(unused),
		create: () => Effect.die(unused),
		createMany: () => Effect.die(unused),
		getWithRelations: () => Effect.die(unused),
	})

// A geocoder that answers each query from a fixed map — a GeocodeResult for a
// hit, the string 'error' to simulate an unreachable geocoder, and null (any
// unlisted query) for a genuine no-match. Every query it is asked is pushed to
// `asked`, so a test can prove the primary and the location-only fallback both
// (or neither) ran.
const geocoderFrom = (
	answers: Record<string, GeocodeResult | 'error'>,
	asked: Array<string>,
) =>
	Geocoder.of({
		lookup: (query: string) => {
			asked.push(query)
			const answer = answers[query] ?? null
			return answer === 'error'
				? Effect.fail(new GeocodeLookupError({ query, cause: 'unreachable' }))
				: Effect.succeed(answer)
		},
	})

const run = (
	company: Record<string, unknown> | null,
	answers: Record<string, GeocodeResult | 'error'>,
	updates: Array<Record<string, unknown>>,
	asked: Array<string> = [],
) =>
	geocodeCompany('c-1').pipe(
		Effect.provideService(CompanyService, companyServiceWith(company, updates)),
		Effect.provideService(Geocoder, geocoderFrom(answers, asked)),
		Effect.provideService(CurrentOrg, currentOrg),
		Effect.runPromise,
	)

describe('geocodeCompany', () => {
	describe('when the name-and-location query resolves', () => {
		it('should store the coordinates and report the geocoded row', async () => {
			// GIVEN a company whose "name, location" query the geocoder resolves
			const updates: Array<Record<string, unknown>> = []
			const asked: Array<string> = []

			// WHEN the company is geocoded
			const result = await run(
				{ name: 'Sunset Transportation', location: 'St. Louis, MO' },
				{
					'Sunset Transportation, St. Louis, MO': {
						latitude: 38.627,
						longitude: -90.199,
						source: 'nominatim',
					},
				},
				updates,
				asked,
			)

			// THEN only the primary query is asked, the four coordinate columns are
			// written, and the outcome carries the updated row
			expect(asked).toEqual(['Sunset Transportation, St. Louis, MO'])
			expect(updates).toHaveLength(1)
			expect(updates[0]).toMatchObject({
				latitude: 38.627,
				longitude: -90.199,
				geocodeSource: 'nominatim',
			})
			expect(result).toMatchObject({ _tag: 'geocoded' })
		})
	})

	describe('when the name-prefixed query misses but the bare location resolves', () => {
		it('should fall back to a location-only lookup and geocode', async () => {
			// GIVEN a company whose "name, location" query resolves to no place,
			// while the location on its own does resolve
			const updates: Array<Record<string, unknown>> = []
			const asked: Array<string> = []

			// WHEN the company is geocoded
			const result = await run(
				{ name: 'Circle Logistics', location: 'Detroit, MI' },
				{
					'Detroit, MI': {
						latitude: 42.331,
						longitude: -83.045,
						source: 'nominatim',
					},
				},
				updates,
				asked,
			)

			// THEN the primary query is tried first, then the location alone, and the
			// fallback hit is persisted
			expect(asked).toEqual(['Circle Logistics, Detroit, MI', 'Detroit, MI'])
			expect(updates).toHaveLength(1)
			expect(updates[0]).toMatchObject({
				latitude: 42.331,
				longitude: -83.045,
				geocodeSource: 'nominatim',
			})
			expect(result).toMatchObject({ _tag: 'geocoded' })
		})
	})

	describe('when neither the name-and-location nor the location resolves', () => {
		it('should write nothing and report no_match', async () => {
			// GIVEN a company no query resolves, primary or fallback
			const updates: Array<Record<string, unknown>> = []
			const asked: Array<string> = []

			// WHEN the company is geocoded
			const result = await run(
				{ name: 'Nowhere Ltd', location: 'Atlantis' },
				{},
				updates,
				asked,
			)

			// THEN both queries were attempted, nothing was written, and the caller
			// learns it was a genuine no-match
			expect(asked).toEqual(['Nowhere Ltd, Atlantis', 'Atlantis'])
			expect(updates).toHaveLength(0)
			expect(result).toEqual({ _tag: 'no_match' })
		})
	})

	describe('when the company has no name or location to search on', () => {
		it('should never call the geocoder and report nothing_to_search', async () => {
			// GIVEN a company with neither a name nor a location, but a geocoder
			// that would happily return a hit if it were asked
			const updates: Array<Record<string, unknown>> = []
			const asked: Array<string> = []

			// WHEN the company is geocoded
			const result = await run(
				{},
				{ Anywhere: { latitude: 1, longitude: 2, source: 'nominatim' } },
				updates,
				asked,
			)

			// THEN the geocoder is never asked, nothing is written
			expect(asked).toEqual([])
			expect(updates).toHaveLength(0)
			expect(result).toEqual({ _tag: 'nothing_to_search' })
		})
	})

	describe('when the geocoder cannot be reached', () => {
		it('should report lookup_failed, kept apart from a no-match', async () => {
			// GIVEN a company whose lookup errors instead of returning a result
			const updates: Array<Record<string, unknown>> = []
			const asked: Array<string> = []

			// WHEN the company is geocoded
			const result = await run(
				{ name: 'Acme', location: 'Berlin' },
				{ 'Acme, Berlin': 'error' },
				updates,
				asked,
			)

			// THEN no coordinates are written and the outage is its own outcome,
			// distinct from "no place found"
			expect(updates).toHaveLength(0)
			expect(result).toEqual({ _tag: 'lookup_failed' })
		})
	})
})

// The decision to re-geocode (a pure predicate) is unit-tested here; the actual
// detached, org-scoped write on a fresh connection is exercised end-to-end
// against a running server, since a stub can't model the transaction/RLS scope
// that made the naive fork wrong.
describe('locationWasReplaced', () => {
	describe('when the update sets a new, non-empty location', () => {
		it('should report the coordinates as stale', () => {
			// GIVEN a company whose location changes to a different place
			// THEN a re-geocode is warranted
			expect(
				locationWasReplaced(
					{ location: 'St. Louis, MO' },
					{ location: 'Kansas City, MO' },
				),
			).toBe(true)
		})
	})

	describe('when the company had no location before', () => {
		it('should report a new location as replacing the (absent) old one', () => {
			// GIVEN a company that gains a location for the first time
			expect(
				locationWasReplaced({ location: null }, { location: 'Sitges' }),
			).toBe(true)
			// GIVEN there was no prior row at all
			expect(locationWasReplaced(null, { location: 'Sitges' })).toBe(true)
		})
	})

	describe('when the update keeps the same location', () => {
		it('should not warrant a re-geocode', () => {
			// GIVEN the location value is written back unchanged
			expect(
				locationWasReplaced({ location: 'Sitges' }, { location: 'Sitges' }),
			).toBe(false)
		})
	})

	describe('when the update clears the location', () => {
		it('should not re-geocode, since a name-only lookup could plant a wrong pin', () => {
			// GIVEN the location is emptied or nulled
			expect(
				locationWasReplaced({ location: 'Sitges' }, { location: '' }),
			).toBe(false)
			expect(
				locationWasReplaced({ location: 'Sitges' }, { location: '   ' }),
			).toBe(false)
			expect(
				locationWasReplaced({ location: 'Sitges' }, { location: null }),
			).toBe(false)
		})
	})

	describe('when the update does not touch the location at all', () => {
		it('should not re-geocode', () => {
			// GIVEN a payload that changes a different field
			expect(
				locationWasReplaced({ location: 'Sitges' }, { status: 'client' }),
			).toBe(false)
		})
	})
})
