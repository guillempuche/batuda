import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import type { Atom } from 'effect/unstable/reactivity'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PaginatedList } from '#/lib/paginated-list'

/**
 * A list that grows as the reader reaches the end of it.
 *
 * Every list endpoint answers with the same envelope — the rows asked for,
 * plus how many match in total — so one hook can drive all of them. Asking
 * for more means asking for a longer window of the same list rather than for
 * a separate page, which keeps what is on screen a single consistent
 * snapshot: no row is duplicated or skipped when somebody else adds one while
 * the reader is scrolling.
 */
export type InfiniteList<T> = {
	/** Rows loaded so far, in server order. */
	readonly items: ReadonlyArray<T>
	/** How many rows match in total, not just how many are loaded. */
	readonly total: number
	/** Whether asking again would bring anything new. */
	readonly hasMore: boolean
	/** First load, with nothing to show yet. */
	readonly isLoadingFirstPage: boolean
	/** More rows are on their way; the ones in hand stay on screen. */
	readonly isLoadingMore: boolean
	/** The first load failed, so there is nothing to show. */
	readonly isError: boolean
	/**
	 * Asking for more failed, but the rows already loaded are still on screen.
	 * Callers must stop asking on their own while this is set, or a failing
	 * request would be retried forever.
	 */
	readonly loadMoreFailed: boolean
	/** Ask for the next window. A no-op while one is already on its way. */
	readonly loadMore: () => void
	/** Refetch what is on screen now. */
	readonly refresh: () => void
}

/**
 * How far into each list the reader has got, kept for as long as the tab
 * lives. Stepping into a record and coming back then shows the same rows as
 * before instead of dropping the reader back at the top of a single page.
 *
 * Only ever written when somebody asks for more, which cannot happen on the
 * server, so one reader's place in a list can never reach another's.
 */
const rememberedWindows = new Map<string, number>()

export function useInfiniteList<T, E>(options: {
	/**
	 * Identifies *which* list this is — the filters, the shelf, the column.
	 * When it changes the window shrinks back to one page, because the rows in
	 * hand belong to a list the reader is no longer looking at.
	 */
	readonly resetKey: string
	/** Rows in the first window, and rows added by each subsequent ask. */
	readonly pageSize: number
	/** Builds the atom that holds a window of `limit` rows. */
	readonly atomFor: (
		limit: number,
	) => Atom.Atom<AsyncResult.AsyncResult<PaginatedList<T>, E>>
}): InfiniteList<T> {
	const { resetKey, pageSize, atomFor } = options

	// Starts at one page every time, including on the server, so the first
	// client render matches the HTML that was sent. Anything remembered from an
	// earlier visit goes back on once the browser takes over.
	const [limit, setLimit] = useState(pageSize)
	useEffect(() => {
		setLimit(rememberedWindows.get(resetKey) ?? pageSize)
	}, [resetKey, pageSize])

	// `resetKey` + `limit` fully identify the atom; `atomFor` is a fresh closure
	// every render and would hand back a different atom each time on its own.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by resetKey
	const atom = useMemo(() => atomFor(limit), [resetKey, limit])
	const result = useAtomValue(atom)
	const refresh = useAtomRefresh(atom)

	// Asking for a longer window starts a fresh request, so the rows in hand
	// would otherwise blank out mid-scroll and take the reader's place in the
	// list with them. Holding the last rows loaded for *this* list keeps them on
	// screen until the longer window arrives; switching lists drops them,
	// because they describe something else.
	//
	// Written during render on purpose: it only ever mirrors the value being
	// rendered, so a repeated render stores the same thing again.
	const held = useRef<{ key: string; page: PaginatedList<T> } | undefined>(
		undefined,
	)
	if (AsyncResult.isSuccess(result)) {
		held.current = { key: resetKey, page: result.value }
	}
	const loaded = AsyncResult.isSuccess(result)
		? result.value
		: held.current?.key === resetKey
			? held.current.page
			: undefined

	const state = useMemo(
		() => readListState<T, E>({ result, loaded }),
		[result, loaded],
	)

	// Remembered at the point of asking rather than by watching the window size:
	// coming back to a list, that size starts at one page before jumping to what
	// was remembered, and a watcher would file the one-page start over the
	// reader's real place.
	const loadMore = useCallback(() => {
		if (!state.hasMore || state.isLoadingMore || state.loadMoreFailed) return
		const next = limit + pageSize
		rememberedWindows.set(resetKey, next)
		setLimit(next)
	}, [
		state.hasMore,
		state.isLoadingMore,
		state.loadMoreFailed,
		limit,
		pageSize,
		resetKey,
	])

	return { ...state, loadMore, refresh }
}

/**
 * What the list looks like right now, given the request in flight and the rows
 * being held from the last one that finished.
 *
 * Split out from the hook so every combination is checkable on its own: the
 * difference between "nothing yet" and "more on the way" decides whether the
 * reader sees a spinner in place of the list or keeps reading it, and the
 * difference between the two kinds of failure decides whether the rows in hand
 * survive.
 */
export function readListState<T, E>(input: {
	readonly result: AsyncResult.AsyncResult<PaginatedList<T>, E>
	/** Rows to show: the ones just loaded, or the ones being held. */
	readonly loaded: PaginatedList<T> | undefined
}): Omit<InfiniteList<T>, 'loadMore' | 'refresh'> {
	const { result, loaded } = input
	const items = loaded?.items ?? []
	const total = loaded?.total ?? 0
	const failed = AsyncResult.isFailure(result)
	const hasRows = loaded !== undefined
	// A longer window is fetched by an atom of its own, so it reports `Initial`
	// rather than `waiting` — treat anything not yet settled as still on its way.
	const pending = !AsyncResult.isSuccess(result) && !failed

	return {
		items,
		total,
		hasMore: items.length < total,
		isLoadingFirstPage: !hasRows && pending,
		isLoadingMore: hasRows && pending,
		isError: failed && !hasRows,
		loadMoreFailed: failed && hasRows,
	}
}
