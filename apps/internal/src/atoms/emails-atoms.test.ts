/**
 * The route loader (SSR) and the route component (browser) both ask for the
 * `/emails` list through `emailsSearchAtom`, and hydration only lands on what
 * the component is about to read if the two share one atom. `canonicalKey` is
 * what decides that: these tests pin what it treats as one search versus two,
 * and that the loader's and the component's own paths to building a search
 * end up sharing one key for the one address.
 */
import { describe, expect, it } from 'vitest'

import { toWireSearch, validateEmailsSearch } from '#/lib/emails-search-params'
import {
	canonicalKey,
	type EmailsSearch,
	emailsSearchAtom,
} from './emails-atoms'

describe('canonicalKey [emails-atoms.ts]', () => {
	describe('when the same filters are given in a different key order', () => {
		it('should produce one key', () => {
			// GIVEN a company and a status, named the two ways round
			// WHEN each is turned into a key
			// THEN they are the same key, or the two would fetch the same rows twice
			expect(canonicalKey({ companyId: 'c1', status: ['open'] })).toBe(
				canonicalKey({ status: ['open'], companyId: 'c1' }),
			)
		})
	})

	describe('when one filter holds the same values in a different order', () => {
		it('should produce one key', () => {
			// GIVEN the two statuses the other way round
			// WHEN each is turned into a key
			// THEN it is the same list either way
			expect(canonicalKey({ status: ['closed', 'open'] })).toBe(
				canonicalKey({ status: ['open', 'closed'] }),
			)
		})
	})

	describe('when count, offset or limit differ', () => {
		it('should produce different keys', () => {
			// GIVEN the same filter, asked for at two different slices, and asked
			// for with and without a count
			// WHEN each is turned into a key
			// THEN each is its own entry, since each is answered with different rows
			// or a different count
			expect(canonicalKey({ companyId: 'c1', offset: 100 })).not.toBe(
				canonicalKey({ companyId: 'c1', offset: 200 }),
			)
			expect(canonicalKey({ companyId: 'c1', limit: 50 })).not.toBe(
				canonicalKey({ companyId: 'c1', limit: 100 }),
			)
			expect(canonicalKey({ companyId: 'c1', count: 'exact' })).not.toBe(
				canonicalKey({ companyId: 'c1', count: 'none' }),
			)
		})
	})

	describe('when a filter holds an empty list, a blank string or is left undefined', () => {
		it('should read all three as not set', () => {
			// GIVEN a list nothing was ticked in, a text box left blank, and a
			// field never mentioned at all
			// WHEN each is turned into a key
			// THEN all three come to the one key an unset search comes to
			// Cast because `exactOptionalPropertyTypes` refuses this literal, though a
			// raw object can still hold it before a patch has gone through `settle`.
			const queryClearedAtRuntime = {
				query: undefined,
			} as unknown as EmailsSearch
			expect(canonicalKey({ status: [] })).toBe(canonicalKey({}))
			expect(canonicalKey({ query: '' })).toBe(canonicalKey({}))
			expect(canonicalKey(queryClearedAtRuntime)).toBe(canonicalKey({}))
		})
	})

	describe('when unread is set versus left absent', () => {
		it('should tell the two apart', () => {
			// GIVEN the same search, with and without unread narrowing it
			// WHEN each is turned into a key
			// THEN they are different lists
			expect(canonicalKey({ companyId: 'c1', unread: 'true' })).not.toBe(
				canonicalKey({ companyId: 'c1' }),
			)
		})
	})

	describe('when a field nothing else here reaches for is set', () => {
		it('should still reach the key', () => {
			// GIVEN a search narrowed only by who a conversation is waiting on
			// WHEN turned into a key
			// THEN it is a different entry from the unset search — the key reads
			// whatever the search holds rather than a list of field names kept in
			// step by hand, which is what stops a new filter from sharing another
			// one's entry
			expect(canonicalKey({ waitingOn: 'us' })).not.toBe(canonicalKey({}))
		})
	})

	describe('when one address is read once as a hand-written link and once as the router round-trips it', () => {
		it('should still come to one key, from the loader and from the component', () => {
			// GIVEN a link written as comma strings — the shape a bookmark or the
			// loader's own address carries — and the same address as the router
			// hands it back after a navigation, as arrays in a different key order
			const asLink = { status: 'closed,open', companyId: 'c1', page: 2 }
			const asRouterRoundTrip = {
				page: 2,
				status: ['open', 'closed'],
				companyId: 'c1',
			}
			// WHEN each goes through the same validate-then-wire pipeline the
			// loader and the component both call before asking for their atom
			const loaderKey = canonicalKey(toWireSearch(validateEmailsSearch(asLink)))
			const componentKey = canonicalKey(
				toWireSearch(validateEmailsSearch(asRouterRoundTrip)),
			)
			// THEN they land on the one key, so hydration lands on the atom the
			// component is about to read rather than fetching it a second time
			expect(loaderKey).toBe(componentKey)
		})
	})
})

describe('emailsSearchAtom [emails-atoms.ts]', () => {
	describe('when two searches narrow the list the same way', () => {
		it('should return the same atom for both', () => {
			// GIVEN one search, and the same filters spelled with the values in
			// the other order
			// WHEN each asks for its atom
			const a = emailsSearchAtom({ status: ['open', 'closed'] })
			const b = emailsSearchAtom({ status: ['closed', 'open'] })
			// THEN it is the one atom, not two fetching the same rows
			expect(a).toBe(b)
		})
	})
})
