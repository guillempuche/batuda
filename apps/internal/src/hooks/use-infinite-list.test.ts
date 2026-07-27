import { AsyncResult } from 'effect/unstable/reactivity'
import { describe, expect, it } from 'vitest'

import { readListState } from '#/hooks/use-infinite-list'
import type { PaginatedList } from '#/lib/paginated-list'

const page = (
	rowCount: number,
	total: number,
	offset = 0,
): PaginatedList<string> => ({
	items: Array.from({ length: rowCount }, (_, index) => `row-${index}`),
	total,
	limit: rowCount,
	offset,
	hasMore: offset + rowCount < total,
})

describe('readListState', () => {
	describe('when the first window is still on its way', () => {
		it('should report the first load and offer nothing to show', () => {
			// GIVEN nothing has arrived and no rows are being held
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.initial<PaginatedList<string>, Error>(true),
				loaded: undefined,
			})

			// THEN the list blocks on its own spinner and promises nothing
			expect(state.isLoadingFirstPage).toBe(true)
			expect(state.isLoadingMore).toBe(false)
			expect(state.items).toEqual([])
			expect(state.total).toBe(0)
			expect(state.hasMore).toBe(false)
			expect(state.isError).toBe(false)
			expect(state.loadMoreFailed).toBe(false)
		})
	})

	describe('when a window has loaded', () => {
		it('should show the rows and promise more while some are unloaded', () => {
			// GIVEN 60 of 312 matching rows have arrived
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.success(page(60, 312)),
				loaded: page(60, 312),
			})

			// THEN the rows show and the list knows it is not finished
			expect(state.items).toHaveLength(60)
			expect(state.total).toBe(312)
			expect(state.hasMore).toBe(true)
			expect(state.isLoadingFirstPage).toBe(false)
			expect(state.isLoadingMore).toBe(false)
		})

		it('should stop promising more once every row is loaded', () => {
			// GIVEN every matching row has arrived
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.success(page(42, 42)),
				loaded: page(42, 42),
			})

			// THEN there is nothing left to ask for
			expect(state.hasMore).toBe(false)
		})

		it('should treat an empty list as finished rather than loading', () => {
			// GIVEN the filters match nothing at all
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.success(page(0, 0)),
				loaded: page(0, 0),
			})

			// THEN the empty state shows instead of a spinner or a "load more"
			expect(state.items).toEqual([])
			expect(state.hasMore).toBe(false)
			expect(state.isLoadingFirstPage).toBe(false)
			expect(state.isError).toBe(false)
		})
	})

	describe('when a longer window is on its way', () => {
		it('should keep the rows in hand on screen instead of blanking', () => {
			// GIVEN a longer window was asked for, so the new request reports
			// `Initial` while the rows from the shorter one are still held
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.initial<PaginatedList<string>, Error>(true),
				loaded: page(60, 312),
			})

			// THEN the reader keeps their place instead of losing the list
			expect(state.items).toHaveLength(60)
			expect(state.isLoadingFirstPage).toBe(false)
			expect(state.isLoadingMore).toBe(true)
			expect(state.hasMore).toBe(true)
		})

		it('should report more on the way when a refresh marks it waiting', () => {
			// GIVEN a refresh of the window already on screen
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.success(page(60, 312), { waiting: true }),
				loaded: page(60, 312),
			})

			// THEN the rows stay put; a refresh is not a first load
			expect(state.isLoadingFirstPage).toBe(false)
			expect(state.items).toHaveLength(60)
		})
	})

	describe('when the request fails', () => {
		it('should report an error only when there is nothing to fall back on', () => {
			// GIVEN the first window failed and no rows are being held
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.fail<Error, PaginatedList<string>>(
					new Error('offline'),
				),
				loaded: undefined,
			})

			// THEN the whole list gives way to the error
			expect(state.isError).toBe(true)
			expect(state.loadMoreFailed).toBe(false)
			expect(state.isLoadingFirstPage).toBe(false)
			expect(state.isLoadingMore).toBe(false)
		})

		it('should keep already-loaded rows when only the next window fails', () => {
			// GIVEN asking for more failed while rows are being held
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.fail<Error, PaginatedList<string>>(
					new Error('offline'),
				),
				loaded: page(60, 312),
			})

			// THEN the rows survive and only the footer reports the failure, so
			// nothing keeps asking on the reader's behalf
			expect(state.items).toHaveLength(60)
			expect(state.isError).toBe(false)
			expect(state.loadMoreFailed).toBe(true)
			expect(state.isLoadingMore).toBe(false)
		})
	})

	describe('when the server reports fewer rows than it promised', () => {
		it('should stop asking rather than chase rows that never arrive', () => {
			// GIVEN a total that undercounts the rows actually returned, which
			// would otherwise leave the list asking for a window it already has
			// WHEN the state is read
			const state = readListState({
				result: AsyncResult.success(page(60, 12)),
				loaded: page(60, 12),
			})

			// THEN nothing more is asked for
			expect(state.hasMore).toBe(false)
		})
	})
})
