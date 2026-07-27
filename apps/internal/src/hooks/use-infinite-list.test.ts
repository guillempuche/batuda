import { Cause } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { describe, expect, it } from 'vitest'

import { readListState } from '#/hooks/use-infinite-list'
import { advance, firstPage, listPageKey } from '#/lib/list-page'
import type { PaginatedList } from '#/lib/paginated-list'

type Row = { readonly id: string }

/** One slice as an endpoint would answer it. */
const page = (input: {
	readonly ids: ReadonlyArray<string>
	readonly hasMore: boolean
	readonly total?: number | null
	readonly limit?: number
	readonly offset?: number
}): PaginatedList<Row> => ({
	items: input.ids.map(id => ({ id })),
	total: input.total ?? null,
	limit: input.limit ?? input.ids.length,
	offset: input.offset ?? 0,
	hasMore: input.hasMore,
})

const idOf = (row: Row) => row.id

const stateOf = (input: {
	readonly result: AsyncResult.AsyncResult<PaginatedList<Row>, string>
	readonly pages?: ReadonlyArray<PaginatedList<Row>>
}) =>
	readListState<Row, string>({
		result: input.result,
		pages: input.pages ?? [],
		idOf,
	})

describe('advance', () => {
	describe('when the server returned exactly what was asked for', () => {
		it('should start the next slice where this one ended', () => {
			// GIVEN a slice of sixty rows starting at the top
			// WHEN asking for the next one
			// THEN it starts at row sixty
			expect(advance(firstPage(60), 60).offset).toBe(60)
		})
	})

	describe('when the server returned fewer rows than were asked for', () => {
		it('should step on by what arrived, not by what was requested', () => {
			// GIVEN sixty rows were asked for and fifty came back
			// WHEN asking for the next slice
			// THEN it starts at fifty. Stepping on by sixty would skip the ten
			//      rows between — never fetched, never shown, and nothing
			//      anywhere to say they were missed.
			expect(advance(firstPage(60), 50).offset).toBe(50)
		})
	})

	describe('when a later slice is asked for', () => {
		it('should stop asking to be counted', () => {
			// GIVEN a counted first slice
			// WHEN moving on
			// THEN the next one is uncounted — the total does not change as the
			//      reader moves down, so it is paid for once
			expect(advance(firstPage(60, 'exact'), 60).count).toBe('none')
		})
	})
})

describe('listPageKey', () => {
	describe('when two slices differ only in whether they are counted', () => {
		it('should tell them apart', () => {
			// GIVEN the same rows asked for both ways
			// WHEN each is keyed
			// THEN the keys differ, because the answers do: one carries a total
			//      and the other does not, and sharing a slot would hand the
			//      wrong one to whichever asked second
			expect(listPageKey(firstPage(60, 'exact'))).not.toBe(
				listPageKey(firstPage(60, 'none')),
			)
		})
	})
})

describe('readListState', () => {
	describe('when the first slice is still on its way', () => {
		it('should report the first load and offer nothing to show', () => {
			// GIVEN no slice has arrived
			// WHEN reading the state
			// THEN the screen is told to show a spinner in place of the list
			const state = stateOf({ result: AsyncResult.initial() })
			expect(state.isLoadingFirstPage).toBe(true)
			expect(state.isLoadingMore).toBe(false)
			expect(state.items).toEqual([])
			expect(state.total).toBeUndefined()
			expect(state.hasMore).toBe(false)
		})
	})

	describe('when a slice has arrived and more follow', () => {
		it('should show the rows and offer to fetch further', () => {
			// GIVEN a full slice that says more exist
			const state = stateOf({
				result: AsyncResult.success(
					page({ ids: ['a', 'b'], hasMore: true, total: 10 }),
				),
			})
			expect(state.items.map(idOf)).toEqual(['a', 'b'])
			expect(state.total).toBe(10)
			expect(state.hasMore).toBe(true)
			expect(state.isLoadingFirstPage).toBe(false)
		})
	})

	describe('when the server says there is nothing after this slice', () => {
		it('should stop, even though a total was never asked for', () => {
			// GIVEN an uncounted slice that reports no more
			// WHEN reading the state
			// THEN the list ends. Nothing here depends on a total, which is what
			//      lets an uncounted list finish at all.
			const state = stateOf({
				result: AsyncResult.success(page({ ids: ['a'], hasMore: false })),
			})
			expect(state.total).toBeUndefined()
			expect(state.hasMore).toBe(false)
		})
	})

	describe('when a slice comes back empty', () => {
		it('should stop regardless of what the slice claims', () => {
			// GIVEN an empty slice that still says more exist
			// WHEN reading the state
			// THEN the list ends anyway — asking again could only return the
			//      same nothing, forever
			const state = stateOf({
				result: AsyncResult.success(page({ ids: [], hasMore: true })),
				pages: [page({ ids: ['a'], hasMore: true })],
			})
			expect(state.hasMore).toBe(false)
		})
	})

	describe('when a slice repeats rows already held', () => {
		it('should keep each row once and stop asking', () => {
			// GIVEN a second slice that returns only a row already on screen —
			//       what an endpoint that ignores where to start would do
			// WHEN reading the state
			// THEN the row appears once, and the list ends rather than fetching
			//      the same slice for as long as the reader keeps scrolling
			const state = stateOf({
				result: AsyncResult.success(page({ ids: ['a'], hasMore: true })),
				pages: [page({ ids: ['a'], hasMore: true })],
			})
			expect(state.items.map(idOf)).toEqual(['a'])
			expect(state.hasMore).toBe(false)
		})
	})

	describe('when rows carry nothing to tell them apart', () => {
		it('should keep every row across a slice boundary', () => {
			// GIVEN two slices of rows with no id of their own, so each is told
			//       apart only by where it sits in the list
			// WHEN reading the state
			// THEN all four survive. Counting a row's position from the wrong
			//      starting point makes the first row of each later slice look
			//      like one already seen, and it disappears — silently, at every
			//      boundary, with the list still claiming to be complete.
			const noIds = (howMany: number, hasMore: boolean) =>
				({
					items: Array.from({ length: howMany }, () => ({}) as Row),
					total: null,
					limit: howMany,
					offset: 0,
					hasMore,
				}) satisfies PaginatedList<Row>
			const state = readListState<Row, string>({
				result: AsyncResult.success(noIds(2, false)),
				pages: [noIds(2, true)],
				idOf: (_row, index) => `#${index}`,
			})
			expect(state.items).toHaveLength(4)
		})
	})

	describe('when a row shifts across a slice boundary', () => {
		it('should show it once', () => {
			// GIVEN somebody inserted a row above the reader between two asks,
			//       so the row that ended the first slice begins the second
			// WHEN reading the state
			// THEN it appears once
			const state = stateOf({
				result: AsyncResult.success(
					page({ ids: ['b', 'c'], hasMore: false, offset: 2 }),
				),
				pages: [page({ ids: ['a', 'b'], hasMore: true })],
			})
			expect(state.items.map(idOf)).toEqual(['a', 'b', 'c'])
		})
	})

	describe('when everything the total promised has arrived', () => {
		it('should stop even if the slice still claims more', () => {
			// GIVEN two rows read out of a promised two
			// WHEN reading the state
			// THEN the list ends
			const state = stateOf({
				result: AsyncResult.success(
					page({ ids: ['b'], hasMore: true, offset: 1 }),
				),
				pages: [page({ ids: ['a'], hasMore: true, total: 2 })],
			})
			expect(state.items).toHaveLength(2)
			expect(state.hasMore).toBe(false)
		})
	})

	describe('when a later slice is on its way', () => {
		it('should keep the rows on screen rather than blanking them', () => {
			// GIVEN rows already read and another slice in flight
			// WHEN reading the state
			// THEN the reader keeps their place instead of seeing a spinner
			const state = stateOf({
				result: AsyncResult.initial(),
				pages: [page({ ids: ['a'], hasMore: true })],
			})
			expect(state.items.map(idOf)).toEqual(['a'])
			expect(state.isLoadingMore).toBe(true)
			expect(state.isLoadingFirstPage).toBe(false)
		})
	})

	describe('when the first load fails', () => {
		it('should report an error with nothing to fall back on', () => {
			const state = stateOf({ result: AsyncResult.failure(Cause.fail('boom')) })
			expect(state.isError).toBe(true)
			expect(state.loadMoreFailed).toBe(false)
			expect(state.items).toEqual([])
		})
	})

	describe('when a later slice fails', () => {
		it('should keep the rows already read and offer to try again', () => {
			// GIVEN one slice read and the next one failing
			// WHEN reading the state
			// THEN nothing already on screen is lost
			const state = stateOf({
				result: AsyncResult.failure(Cause.fail('boom')),
				pages: [page({ ids: ['a'], hasMore: true })],
			})
			expect(state.isError).toBe(false)
			expect(state.loadMoreFailed).toBe(true)
			expect(state.items.map(idOf)).toEqual(['a'])
		})
	})

	describe('when a failed slice is being retried', () => {
		it('should read as loading rather than still failed', () => {
			// GIVEN a failure that is being asked again
			// WHEN reading the state
			// THEN the button reads as busy instead of offering "try again"
			//      under a request that is already running
			const state = stateOf({
				result: AsyncResult.failure(Cause.fail('boom'), { waiting: true }),
				pages: [page({ ids: ['a'], hasMore: true })],
			})
			expect(state.loadMoreFailed).toBe(false)
			expect(state.isLoadingMore).toBe(true)
		})
	})

	describe('when only the first slice was counted', () => {
		it('should hold that total through the uncounted ones', () => {
			// GIVEN a counted first slice and an uncounted second
			// WHEN reading the state
			// THEN the total survives — later slices do not ask for one, and
			//      treating their silence as zero would empty the count
			const state = stateOf({
				result: AsyncResult.success(
					page({ ids: ['b'], hasMore: false, total: null, offset: 1 }),
				),
				pages: [page({ ids: ['a'], hasMore: true, total: 9 })],
			})
			expect(state.total).toBe(9)
		})
	})
})
