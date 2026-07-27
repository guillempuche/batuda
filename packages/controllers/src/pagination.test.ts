import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { MAX_PAGE_LIMIT, PaginatedList, pageQuery } from './pagination'

// The query fields reach an endpoint spread into its `query` block, so decode
// them the same way — as one struct of the three, exactly as a URL delivers
// them (everything a string).
const PageQuery = Schema.Struct({ ...pageQuery })

const decodeQuery = (input: unknown) =>
	Schema.decodeUnknownExit(Schema.toCodecJson(PageQuery))(input)

describe('pageQuery', () => {
	describe('when the caller asks for a window it is allowed', () => {
		it('should accept a limit at the ceiling', () => {
			// GIVEN the largest window any screen legitimately needs
			// WHEN the query decodes
			// THEN it is accepted, so the ceiling itself is reachable
			const exit = decodeQuery({ limit: String(MAX_PAGE_LIMIT) })
			expect(exit._tag).toBe('Success')
		})

		it('should accept an offset of zero', () => {
			// GIVEN the first page
			// WHEN the query decodes
			// THEN it is accepted — zero is a real offset, not a missing one
			const exit = decodeQuery({ offset: '0' })
			expect(exit._tag).toBe('Success')
		})

		it('should leave every field absent when none was asked for', () => {
			// GIVEN a request with no paging at all
			// WHEN the query decodes
			// THEN it succeeds, leaving each default to the endpoint
			const exit = decodeQuery({})
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when the caller asks for more than the ceiling allows', () => {
		it('should refuse rather than quietly shrink the window', () => {
			// GIVEN one row past the ceiling
			// WHEN the query decodes
			// THEN it fails, so the caller is told instead of being handed a
			// shorter page it did not ask for and cannot detect
			const exit = decodeQuery({ limit: String(MAX_PAGE_LIMIT + 1) })
			expect(exit._tag).toBe('Failure')
		})

		it('should refuse a wildly oversized window', () => {
			// GIVEN a limit that would pull an entire table
			const exit = decodeQuery({ limit: '1000000' })
			expect(exit._tag).toBe('Failure')
		})
	})

	describe('when the window is not a usable number', () => {
		it('should refuse a limit of zero', () => {
			// GIVEN a page with no rows in it, which no caller can mean
			const exit = decodeQuery({ limit: '0' })
			expect(exit._tag).toBe('Failure')
		})

		it('should refuse text', () => {
			// GIVEN a limit that is not a number at all
			// WHEN the query decodes
			// THEN it fails at the edge. Plain number parsing turns this into
			// not-a-number, which reaches the database as `LIMIT NaN` and fails
			// there instead — a fault rather than a refusal.
			const exit = decodeQuery({ limit: 'abc' })
			expect(exit._tag).toBe('Failure')
		})

		it('should refuse a fraction', () => {
			// GIVEN half a row
			const exit = decodeQuery({ limit: '2.5' })
			expect(exit._tag).toBe('Failure')
		})

		it('should refuse an unbounded window', () => {
			// GIVEN Infinity, which parses as a number but bounds nothing
			const exit = decodeQuery({ limit: 'Infinity' })
			expect(exit._tag).toBe('Failure')
		})

		it('should refuse a negative offset', () => {
			// GIVEN a starting point before the beginning of the list
			const exit = decodeQuery({ offset: '-1' })
			expect(exit._tag).toBe('Failure')
		})
	})

	describe('when the caller says whether to count', () => {
		it('should accept both ways of answering', () => {
			// GIVEN each of the two answers
			// WHEN each decodes
			// THEN both are accepted
			expect(decodeQuery({ count: 'exact' })._tag).toBe('Success')
			expect(decodeQuery({ count: 'none' })._tag).toBe('Success')
		})

		it('should refuse anything else', () => {
			// GIVEN a third answer that does not exist
			// WHEN the query decodes
			// THEN it fails, rather than being read as "do not count" and
			// silently costing the caller its total
			const exit = decodeQuery({ count: 'approximate' })
			expect(exit._tag).toBe('Failure')
		})
	})
})

describe('PaginatedList', () => {
	const Envelope = PaginatedList(Schema.String)
	const decodeEnvelope = (input: unknown) =>
		Schema.decodeUnknownExit(Schema.toCodecJson(Envelope))(input)

	describe('when the page was counted', () => {
		it('should carry the total through', () => {
			// GIVEN a counted page
			// WHEN it decodes
			// THEN the total survives as a number
			const exit = decodeEnvelope({
				items: ['a'],
				total: 42,
				limit: 1,
				offset: 0,
				hasMore: true,
			})
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when the page was not counted', () => {
		it('should accept a null total', () => {
			// GIVEN a page nobody asked to have counted
			// WHEN it decodes
			// THEN null is accepted — "not counted" is a state the wire can carry,
			// and it is not the same as "none matched"
			const exit = decodeEnvelope({
				items: ['a'],
				total: null,
				limit: 1,
				offset: 0,
				hasMore: true,
			})
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when the envelope is missing what a reader needs', () => {
		it('should refuse a page with no answer about more rows', () => {
			// GIVEN an envelope without `hasMore`
			// WHEN it decodes
			// THEN it fails. Without it a reader has only the total to go on, and
			// a page that was not counted has no total either — so the list would
			// have no way to know whether to ask again.
			const exit = decodeEnvelope({
				items: ['a'],
				total: null,
				limit: 1,
				offset: 0,
			})
			expect(exit._tag).toBe('Failure')
		})
	})
})
