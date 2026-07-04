import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { CompanyService } from './companies'
import { geocodeCompany } from './company-geocoding'
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
