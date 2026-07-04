import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { CompanyService } from './companies'
import { geocodeCompany, locationWasReplaced } from './company-geocoding'
import { Geocoder } from './geocoder'

const unused = new Error('method not used in this test')
const currentOrg = { id: 'org-1', name: 'fixture', slug: 'fixture' }

// A CompanyService whose findById returns the given row and whose update
// records the fields it was asked to write, so the test can inspect them.
// The other methods are never reached here.
const companyServiceWith = (
	company: Record<string, unknown> | null,
	updates: Array<Record<string, unknown>>,
) =>
	CompanyService.of({
		findById: () =>
			company === null
				? Effect.die(new Error('company not found'))
				: Effect.succeed(company),
		update: (_id: string, data: Record<string, unknown>) =>
			Effect.sync(() => {
				updates.push(data)
				return [{ ...company, ...data }]
			}),
		search: () => Effect.die(unused),
		findBySlug: () => Effect.die(unused),
		create: () => Effect.die(unused),
		getWithRelations: () => Effect.die(unused),
	})

const geocoderReturning = (
	hit: { latitude: number; longitude: number; source: string } | null,
) => Geocoder.of({ lookup: () => Effect.succeed(hit) })

const run = (
	company: Record<string, unknown> | null,
	hit: { latitude: number; longitude: number; source: string } | null,
	updates: Array<Record<string, unknown>>,
) =>
	geocodeCompany('c-1').pipe(
		Effect.provideService(CompanyService, companyServiceWith(company, updates)),
		Effect.provideService(Geocoder, geocoderReturning(hit)),
		Effect.provideService(CurrentOrg, currentOrg),
		Effect.runPromise,
	)

describe('geocodeCompany', () => {
	describe('when the geocoder returns a match', () => {
		it('should store latitude, longitude and the geocode source', async () => {
			// GIVEN a company with a location and a geocoder that resolves it
			const updates: Array<Record<string, unknown>> = []

			// WHEN the company is geocoded
			const result = await run(
				{ name: 'Sunset Transportation', location: 'St. Louis, MO' },
				{ latitude: 38.627, longitude: -90.199, source: 'nominatim' },
				updates,
			)

			// THEN exactly the four coordinate columns are written, and the
			// updated row comes back
			expect(updates).toHaveLength(1)
			expect(updates[0]).toMatchObject({
				latitude: 38.627,
				longitude: -90.199,
				geocodeSource: 'nominatim',
			})
			expect(result).not.toBeNull()
		})
	})

	describe('when the geocoder finds no match', () => {
		it('should store nothing and return null', async () => {
			// GIVEN a company whose location the geocoder cannot resolve
			const updates: Array<Record<string, unknown>> = []

			// WHEN the company is geocoded
			const result = await run(
				{ name: 'Nowhere Ltd', location: 'Atlantis' },
				null,
				updates,
			)

			// THEN no coordinates are written and the caller learns nothing was stored
			expect(updates).toHaveLength(0)
			expect(result).toBeNull()
		})
	})

	describe('when the company has no name or location to search on', () => {
		it('should never send an empty query and return null', async () => {
			// GIVEN a company with neither a name nor a location, but a geocoder
			// that would happily return a hit if it were asked
			const updates: Array<Record<string, unknown>> = []

			// WHEN the company is geocoded
			const result = await run(
				{},
				{ latitude: 1, longitude: 2, source: 'nominatim' },
				updates,
			)

			// THEN the lookup is skipped entirely — no write, nothing stored
			expect(updates).toHaveLength(0)
			expect(result).toBeNull()
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
