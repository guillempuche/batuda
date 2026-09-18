/**
 * The `/emails` address is read and written by three different callers — the
 * route's `validateSearch`, the list's filter controls, and the pager — and
 * all three have to agree on one shape or a link built by one of them would
 * mean something different to another. These tests pin what an address
 * decodes to, including the one real bug this file exists to prevent: a
 * `?offset=` or `?limit=` left over from a previous request riding along
 * into a new one while the page still says it is showing something else.
 */
import { describe, expect, it } from 'vitest'

import { STALE_DAYS_BOUNDS } from '@batuda/controllers'

import { EMAILS_PAGE_SIZE } from '#/atoms/emails-atoms'
import {
	DEFAULT_THREAD_SORT,
	hasActiveFilters,
	mergeSearch,
	QUIET_DAY_CHOICES,
	toggleValue,
	toWireSearch,
	validateEmailsSearch,
} from './emails-search-params'

describe('validateEmailsSearch [emails-search-params.ts]', () => {
	describe('when status arrives in one of the shapes a link can carry it in', () => {
		it('should read a comma string, a list and a single old-bookmark value the same way', () => {
			// GIVEN the same two statuses spelled three ways
			// WHEN validated
			// THEN all three read as the same set
			expect(validateEmailsSearch({ status: 'open,closed' }).status).toEqual([
				'open',
				'closed',
			])
			expect(
				validateEmailsSearch({ status: ['open', 'closed'] }).status,
			).toEqual(['open', 'closed'])
			// A bookmark saved before the filter took several values at once
			expect(validateEmailsSearch({ status: 'open' }).status).toEqual(['open'])
		})
	})

	describe('when status names nobody', () => {
		it('should read `status=` and `status=,` as no one asking', () => {
			// GIVEN a param left by a cleared control, and one made only of commas
			// WHEN validated
			// THEN both come back holding nothing, so neither narrows the list
			const empty = validateEmailsSearch({ status: '' })
			const commasOnly = validateEmailsSearch({ status: ',' })
			expect(empty.status).toEqual([])
			expect(commasOnly.status).toEqual([])
			expect(hasActiveFilters(empty)).toBe(false)
			expect(hasActiveFilters(commasOnly)).toBe(false)
		})
	})

	describe('when one word in a status list is not a status', () => {
		it('should refuse the whole list rather than keep the word it does know', () => {
			// GIVEN a good status next to a made-up one
			const out = validateEmailsSearch({ status: 'open,bogus' })
			// WHEN validated
			// THEN the filter is covered whole, the same as any other bad value —
			// it does not fall back to filtering by "open" alone
			expect('status' in out).toBe(true)
			expect(out.status).toBeUndefined()
		})
	})

	describe('when unread or hasAttachments is given', () => {
		it('should keep `true` and drop `false` or any other word', () => {
			// GIVEN the word that narrows, its opposite, and a word that means the
			// same thing to a person but not to the server
			// WHEN validated
			// THEN only the exact word the server reads survives
			expect(validateEmailsSearch({ unread: 'true' }).unread).toBe('true')
			expect(validateEmailsSearch({ unread: 'false' }).unread).toBeUndefined()
			expect(validateEmailsSearch({ unread: 'yes' }).unread).toBeUndefined()
			expect(
				validateEmailsSearch({ hasAttachments: 'true' }).hasAttachments,
			).toBe('true')
			expect(
				validateEmailsSearch({ hasAttachments: 'false' }).hasAttachments,
			).toBeUndefined()
			expect(
				validateEmailsSearch({ hasAttachments: 'yes' }).hasAttachments,
			).toBeUndefined()
		})
	})

	describe('when quietDays is given', () => {
		it('should read a plain number and a numeral written as text the same way', () => {
			// GIVEN 14 as the router would parse it, and as a hand-written link
			// would carry it
			// WHEN validated
			// THEN both read as the number
			expect(validateEmailsSearch({ quietDays: 14 }).quietDays).toBe(14)
			expect(validateEmailsSearch({ quietDays: '14' }).quietDays).toBe(14)
		})

		it('should refuse zero, past the ceiling, a fraction, text and a negative number', () => {
			// GIVEN every way a quietDays value can be wrong: under the floor, over
			// the ceiling, not a whole number, not a number at all, and negative
			// WHEN validated
			// THEN none of them survive as a filter
			expect(validateEmailsSearch({ quietDays: 0 }).quietDays).toBeUndefined()
			expect(
				validateEmailsSearch({ quietDays: STALE_DAYS_BOUNDS.maximum + 1 })
					.quietDays,
			).toBeUndefined()
			expect(validateEmailsSearch({ quietDays: 7.5 }).quietDays).toBeUndefined()
			expect(
				validateEmailsSearch({ quietDays: 'abc' }).quietDays,
			).toBeUndefined()
			expect(validateEmailsSearch({ quietDays: -3 }).quietDays).toBeUndefined()
		})

		it('should accept every choice the dropdown itself offers', () => {
			// GIVEN the exact numbers the quiet-days control shows
			for (const days of QUIET_DAY_CHOICES) {
				// WHEN validated
				// THEN the control never offers a value the server would refuse
				expect(validateEmailsSearch({ quietDays: days }).quietDays).toBe(days)
			}
		})
	})

	describe('when waitingOn or sort names a word the server does not read', () => {
		it('should refuse it', () => {
			// GIVEN a value neither list of words offers
			// WHEN validated
			// THEN both are covered rather than passed on
			expect(
				validateEmailsSearch({ waitingOn: 'nobody' }).waitingOn,
			).toBeUndefined()
			expect(validateEmailsSearch({ sort: 'oldest' }).sort).toBeUndefined()
		})
	})

	describe('when sort repeats the default the server already reads a bare address by', () => {
		it('should drop it, so a link with it and a link without it are one address', () => {
			// GIVEN the sort spelled out even though it changes nothing
			const out = validateEmailsSearch({ sort: DEFAULT_THREAD_SORT })
			// WHEN validated
			// THEN it reads the same as an address that never mentioned sort
			expect('sort' in out).toBe(true)
			expect(out.sort).toBeUndefined()
		})
	})

	describe('when companyOwner names "none" or a user id', () => {
		it('should keep either one as a one-item list', () => {
			// GIVEN the word for an unclaimed company, and an id made only of digits
			// WHEN validated
			// THEN both read as a list holding that one value, not as a number or a
			// special case of their own
			expect(
				validateEmailsSearch({ companyOwner: 'none' }).companyOwner,
			).toEqual(['none'])
			expect(
				validateEmailsSearch({ companyOwner: '482910' }).companyOwner,
			).toEqual(['482910'])
		})
	})

	describe('when page is given', () => {
		it('should read a numeral written as text as that page', () => {
			// GIVEN a hand-written `?page=3`
			// WHEN validated
			// THEN it reads as the number
			expect(validateEmailsSearch({ page: '3' }).page).toBe(3)
		})

		it('should refuse a page of zero and a page that is not a number', () => {
			// GIVEN a page below the first one, and one that is not a number at all
			// WHEN validated
			// THEN neither survives as a page to fetch
			expect(validateEmailsSearch({ page: 0 }).page).toBeUndefined()
			expect(validateEmailsSearch({ page: 'abc' }).page).toBeUndefined()
		})
	})

	describe('when the address carries a request-only param', () => {
		it('should cover limit, offset and count so a stale one can never survive into a new request', () => {
			// GIVEN a link still carrying the previous request's own words — the
			// real bug this guards: `?offset=250` would otherwise fetch rows 251 to
			// 350 while the page went on saying it was showing the first hundred
			const out = validateEmailsSearch({
				limit: 50,
				offset: 250,
				count: 'exact',
				query: 'acme',
			})
			// WHEN validated
			// THEN all three are covered, and the filter beside them is untouched
			expect('limit' in out).toBe(true)
			expect('offset' in out).toBe(true)
			expect('count' in out).toBe(true)
			expect(out.limit).toBeUndefined()
			expect(out.offset).toBeUndefined()
			expect(out.count).toBeUndefined()
			expect(out.query).toBe('acme')
		})

		it('should not invent them for an address that never carried them', () => {
			// GIVEN an address with none of the three
			const out = validateEmailsSearch({ query: 'acme' })
			// WHEN validated
			// THEN none of them is added
			expect('limit' in out).toBe(false)
			expect('offset' in out).toBe(false)
			expect('count' in out).toBe(false)
		})
	})

	describe('when one param cannot be read', () => {
		it('should still read the params beside it', () => {
			// GIVEN a bad status next to a good query and a good page
			const out = validateEmailsSearch({
				status: 'bogus',
				query: 'acme',
				page: '2',
			})
			// WHEN validated
			// THEN the one bad param is covered and its neighbours read fine
			expect(out.status).toBeUndefined()
			expect(out.query).toBe('acme')
			expect(out.page).toBe(2)
		})
	})
})

describe('toWireSearch [emails-search-params.ts]', () => {
	describe('when the search carries no filters', () => {
		it('should ask for one counted page of EMAILS_PAGE_SIZE with no offset', () => {
			// GIVEN an address with nothing set
			const wire = toWireSearch({})
			// WHEN turned into a request
			// THEN it asks for the first page, counted, with no offset written
			expect(wire).toEqual({ limit: EMAILS_PAGE_SIZE, count: 'exact' })
			expect('offset' in wire).toBe(false)
		})
	})

	describe('when a page past the first is asked for', () => {
		it('should turn it into the matching offset and drop `page` from the request', () => {
			// GIVEN page 3 of a list read EMAILS_PAGE_SIZE at a time
			const wire = toWireSearch({ page: 3 })
			// WHEN turned into a request
			// THEN the server is asked for the matching slice, not for a page number
			expect(wire.offset).toBe((3 - 1) * EMAILS_PAGE_SIZE)
			expect('page' in wire).toBe(false)
		})
	})

	describe('when a filter is blank', () => {
		it('should drop it rather than send it as an empty value', () => {
			// GIVEN a cleared query box and a status list nothing is ticked in
			const wire = toWireSearch({ query: '', status: [] })
			// WHEN turned into a request
			// THEN neither reaches the server
			expect('query' in wire).toBe(false)
			expect('status' in wire).toBe(false)
		})
	})

	describe('when the search carries real filters', () => {
		it('should pass every one of them through unchanged', () => {
			// GIVEN a full set of filters
			const wire = toWireSearch({
				companyId: 'c1',
				status: ['open', 'closed'],
				unread: 'true',
				quietDays: 14,
			})
			// WHEN turned into a request
			// THEN each one reaches it exactly as given
			expect(wire.companyId).toBe('c1')
			expect(wire.status).toEqual(['open', 'closed'])
			expect(wire.unread).toBe('true')
			expect(wire.quietDays).toBe(14)
		})
	})
})

describe('mergeSearch [emails-search-params.ts]', () => {
	describe('when the patch touches a filter', () => {
		it('should drop the page, since the old page might not exist in the new list', () => {
			// GIVEN page 5 of one list
			const prev = { page: 5, companyId: 'c1' }
			// WHEN a filter is added
			const next = mergeSearch(prev, { status: ['open'] })
			// THEN the page is gone, not carried over to the narrower list
			expect('page' in next).toBe(false)
			expect(next.status).toEqual(['open'])
		})
	})

	describe('when the patch only moves the page', () => {
		it('should keep every filter untouched', () => {
			// GIVEN a list already narrowed by a company and a status
			const prev = { companyId: 'c1', status: ['open'] as const, page: 2 }
			// WHEN only the page changes
			const next = mergeSearch(prev, { page: 3 })
			// THEN the filters ride along unchanged
			expect(next.companyId).toBe('c1')
			expect(next.status).toEqual(['open'])
			expect(next.page).toBe(3)
		})
	})

	describe('when the merged page is 1 or less', () => {
		it('should never write it', () => {
			// GIVEN a list on page 2
			const prev = { companyId: 'c1', page: 2 }
			// WHEN the page is set back to the first one
			const next = mergeSearch(prev, { page: 1 })
			// THEN page is left off rather than written as 1
			expect('page' in next).toBe(false)
			expect(next.companyId).toBe('c1')
		})
	})

	describe('when a patch clears a value', () => {
		it('should remove the key rather than write it as undefined', () => {
			// GIVEN a search with a free-text query set
			const prev = { companyId: 'c1', query: 'acme' }
			// WHEN the patch clears it
			const next = mergeSearch(prev, { query: undefined })
			// THEN the key is gone entirely
			expect('query' in next).toBe(false)
			expect(next.companyId).toBe('c1')
		})
	})

	describe('when unread is set through a patch', () => {
		it('should only ever be true or absent, never false', () => {
			// GIVEN no filter set
			// WHEN unread is turned on
			const on = mergeSearch({}, { unread: 'true' })
			// THEN it reads true
			expect(on.unread).toBe('true')
			// WHEN it is turned back off
			const off = mergeSearch(on, { unread: undefined })
			// THEN the key is gone, not written as false
			expect('unread' in off).toBe(false)
		})
	})
})

describe('toggleValue [emails-search-params.ts]', () => {
	describe('when the value is not yet chosen', () => {
		it('should add it and reset the page', () => {
			// GIVEN a list with nothing ticked, on page 4
			const prev = { page: 4 }
			// WHEN a status is ticked
			const next = toggleValue(prev, 'status', 'open')
			// THEN it is added and the page is dropped
			expect(next.status).toEqual(['open'])
			expect('page' in next).toBe(false)
		})
	})

	describe('when the value is already chosen', () => {
		it('should remove it', () => {
			// GIVEN one status ticked
			const prev = { status: ['open'] as const }
			// WHEN the same status is ticked again
			const next = toggleValue(prev, 'status', 'open')
			// THEN nothing narrows the list by status any more
			expect('status' in next).toBe(false)
		})
	})

	describe('when the same value was written more than once by hand', () => {
		it('should remove every copy in one press', () => {
			// GIVEN a hand-written `?status=open,open,closed`
			const prev = { status: ['open', 'open', 'closed'] as const }
			// WHEN that status is ticked off
			const next = toggleValue(prev, 'status', 'open')
			// THEN both copies are gone in the one press, not just the first
			expect(next.status).toEqual(['closed'])
		})
	})

	describe('when the last value in a filter is removed', () => {
		it('should drop the key rather than leave an empty list', () => {
			// GIVEN the one status ticked
			const prev = { status: ['open'] as const }
			// WHEN it is un-ticked
			const next = toggleValue(prev, 'status', 'open')
			// THEN the key itself is gone
			expect('status' in next).toBe(false)
		})
	})

	describe('when two toggles are built one on the other', () => {
		it('should keep both, not just the second', () => {
			// GIVEN a list with nothing ticked
			const first = toggleValue({}, 'status', 'open')
			// WHEN a second status is ticked on the result of the first
			const second = toggleValue(first, 'status', 'closed')
			// THEN both are on the list
			expect(second.status).toEqual(['open', 'closed'])
		})
	})
})

describe('hasActiveFilters [emails-search-params.ts]', () => {
	describe('when only the page or the sort is set', () => {
		it('should read as no filters active', () => {
			// GIVEN an address that only says which page or which order
			// WHEN checked
			// THEN neither counts as narrowing the list
			expect(hasActiveFilters({ page: 3 })).toBe(false)
			expect(hasActiveFilters({ sort: 'latest_message' })).toBe(false)
		})
	})

	describe('when a real filter is set', () => {
		it('should read as active for each filter that narrows the list', () => {
			// GIVEN one filter set at a time
			// WHEN checked
			// THEN every one of them counts as active
			expect(hasActiveFilters({ quietDays: 14 })).toBe(true)
			expect(hasActiveFilters({ query: 'acme' })).toBe(true)
			expect(hasActiveFilters({ inboxId: 'i1' })).toBe(true)
			expect(hasActiveFilters({ companyId: 'c1' })).toBe(true)
			expect(hasActiveFilters({ status: ['open'] })).toBe(true)
			expect(hasActiveFilters({ unread: 'true' })).toBe(true)
		})
	})
})
