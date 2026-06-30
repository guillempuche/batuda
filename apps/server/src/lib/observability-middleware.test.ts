import { describe, expect, it } from 'vitest'

import { httpPathPattern } from './observability-middleware.js'

// Locks in how request URLs are normalised before they become span attributes
// and log fields: record ids collapse to :id so errors group by route, and the
// query string / fragment are dropped so a secret in `?code=…` never leaks.

describe('httpPathPattern', () => {
	describe('when the url has no dynamic segment or query', () => {
		it('should return the path unchanged', () => {
			// GIVEN a static route
			// WHEN normalised
			// THEN it is returned as-is
			// [httpPathPattern]
			expect(httpPathPattern('/companies')).toBe('/companies')
		})
	})

	describe('when the url embeds a uuid record id', () => {
		it('should replace the uuid with :id', () => {
			// GIVEN a route with a record uuid
			// WHEN normalised
			// THEN the uuid collapses to :id so errors group by route
			// [UUID → :id]
			expect(
				httpPathPattern('/companies/3f2504e0-4f89-41d3-9a0c-0305e82c3301'),
			).toBe('/companies/:id')
		})

		it('should replace every uuid when more than one appears', () => {
			// GIVEN a nested route with two uuids
			// WHEN normalised
			// THEN both collapse to :id (global replace, case-insensitive)
			// [UUID global flag]
			expect(
				httpPathPattern(
					'/orgs/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE/contacts/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
				),
			).toBe('/orgs/:id/contacts/:id')
		})
	})

	describe('when the url carries a query string', () => {
		it('should drop the query so secrets never reach a span or log', () => {
			// GIVEN an OAuth callback whose query holds a code
			// WHEN normalised
			// THEN only the path survives; the query (and any token in it) is gone
			// [split('?')]
			expect(httpPathPattern('/auth/callback?code=secret&state=xyz')).toBe(
				'/auth/callback',
			)
		})
	})

	describe('when the url is a reset-password link (token in the path)', () => {
		it('should collapse the token segment so it never reaches a log', () => {
			// GIVEN a reset-password URL whose token rides in the path, not the query
			// WHEN normalised
			// THEN the token segment collapses to :token (a raw token in a log line
			//   would be a single-use credential leak)
			// [/auth/reset-password/ branch]
			expect(
				httpPathPattern('/auth/reset-password/eyJhbGciOi-secret-token'),
			).toBe('/auth/reset-password/:token')
		})
	})

	describe('when the url is a magic-link verify (token in the query)', () => {
		it('should drop the token along with the query', () => {
			// GIVEN a magic-link verify URL with the token in the query
			// WHEN normalised
			// THEN only the path survives; the token is gone
			// [split('?')]
			expect(
				httpPathPattern('/auth/magic-link/verify?token=secret-magic-token'),
			).toBe('/auth/magic-link/verify')
		})
	})

	describe('when the url carries a fragment', () => {
		it('should drop the fragment', () => {
			// GIVEN a url with a hash fragment
			// WHEN normalised
			// THEN the fragment is dropped
			// [split('#')]
			expect(httpPathPattern('/pages/about#section')).toBe('/pages/about')
		})
	})
})
