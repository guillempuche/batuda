import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import type { Atom } from 'effect/unstable/reactivity'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { advance, firstPage, type ListPage } from '#/lib/list-page'
import type { PaginatedList } from '#/lib/paginated-list'

/**
 * A list that grows as the reader reaches the end of it.
 *
 * Each slice is fetched once and kept, so reaching the fifth screenful costs
 * one more request rather than re-reading everything above it. The rows on
 * screen are therefore stitched together from several moments rather than one:
 * a row added above the reader while they scroll arrives twice and is dropped
 * the second time, and a row deleted above them can slip past unseen until the
 * list is asked for again. That is the price of not re-reading the whole list
 * on every step, and it is invisible at the sizes these lists reach.
 */
export type InfiniteList<T> = {
	/** Rows loaded so far, in server order, each appearing once. */
	readonly items: ReadonlyArray<T>
	/**
	 * How many rows match in total, or undefined when nothing asked to be
	 * counted. Undefined means "not known", which is not zero — a screen that
	 * treats it as zero says a full list is empty.
	 */
	readonly total: number | undefined
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
	/** Ask for the next slice. A no-op while one is already on its way. */
	readonly loadMore: () => void
	/** Ask again for the slice that just failed, keeping the rows already read. */
	readonly retry: () => void
	/** Start the list over from the top. */
	readonly refresh: () => void
}

/** Slices already absorbed, plus the one currently being read. */
type Accumulated<T> = {
	readonly pages: ReadonlyArray<PaginatedList<T>>
	readonly page: ListPage
}

/**
 * How far into each list the reader has got, kept for as long as the tab
 * lives. Stepping into a record and coming back then shows the same rows as
 * before instead of dropping the reader back at the top of the list.
 *
 * Only ever written when somebody asks for more, which cannot happen on the
 * server, so one reader's place in a list can never reach another's.
 */
const rememberedLists = new Map<string, Accumulated<unknown>>()

/** Rows are told apart by `id` where they have one. */
function defaultIdOf(row: unknown, index: number): string {
	return typeof row === 'object' &&
		row !== null &&
		typeof (row as { id?: unknown }).id === 'string'
		? (row as { id: string }).id
		: `#${index}`
}

export function useInfiniteList<T, E>(options: {
	/**
	 * Identifies *which* list this is — the filters, the shelf, the column.
	 * When it changes the list starts over, because the rows in hand belong to
	 * one the reader is no longer looking at.
	 */
	readonly resetKey: string
	/** Rows in the first slice, and rows added by each subsequent ask. */
	readonly pageSize: number
	/** Whether the first slice should ask to be counted. */
	readonly count?: ListPage['count']
	/** Builds the atom holding one slice. */
	readonly atomFor: (
		page: ListPage,
	) => Atom.Atom<AsyncResult.AsyncResult<PaginatedList<T>, E>>
	/**
	 * What makes a row distinct, when `id` will not do. The research queue
	 * keys its rows by the pair they belong to rather than by an id of their
	 * own, so it says so here.
	 */
	readonly idOf?: (row: T, index: number) => string
}): InfiniteList<T> {
	const { resetKey, pageSize, count = 'none', atomFor, idOf } = options

	const fresh = useCallback(
		(): Accumulated<T> => ({ pages: [], page: firstPage(pageSize, count) }),
		[pageSize, count],
	)

	// Only ever restored for a list asking for the same shape of slice, so a
	// screen cannot inherit another's place just because they happen to be
	// looking at the same filters.
	const remembered = useCallback((): Accumulated<T> | undefined => {
		const held = rememberedLists.get(resetKey) as Accumulated<T> | undefined
		if (held === undefined) return undefined
		return held.page.limit === pageSize ? held : undefined
	}, [resetKey, pageSize])

	const [store, setStore] = useState<{
		readonly key: string
		readonly acc: Accumulated<T>
	}>(() => ({ key: resetKey, acc: fresh() }))

	// Switching lists takes effect in the very render that switches, not one
	// tick later. Waiting would spend that render asking for a slice deep
	// inside a list nobody has read yet — a real request, thrown away
	// immediately — while showing the previous list's rows and its count.
	const acc = store.key === resetKey ? store.acc : (remembered() ?? fresh())
	if (store.key !== resetKey) setStore({ key: resetKey, acc })

	// The remembered place is restored once the browser takes over, never
	// during the server render, so the first client render still matches the
	// HTML that was sent.
	useEffect(() => {
		const held = remembered()
		if (held !== undefined) setStore({ key: resetKey, acc: held })
	}, [resetKey, remembered])

	// `resetKey` plus the slice fully identify the atom; `atomFor` is a fresh
	// closure every render and would hand back a different atom on its own.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by resetKey
	const atom = useMemo(() => atomFor(acc.page), [resetKey, acc.page])
	const result = useAtomValue(atom)
	const refreshCurrent = useAtomRefresh(atom)

	// Held so `refresh` can restart the list even while a later slice is the
	// one being read.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by resetKey
	const firstAtom = useMemo(
		() => atomFor(firstPage(pageSize, count)),
		[resetKey, pageSize, count],
	)
	const refreshFirst = useAtomRefresh(firstAtom)

	const rowIdOf = (idOf ?? defaultIdOf) as (row: T, index: number) => string
	const state = useMemo(
		() => readListState<T, E>({ result, pages: acc.pages, idOf: rowIdOf }),
		[result, acc.pages, rowIdOf],
	)

	// The slice in hand is absorbed at the moment more is asked for, rather
	// than as it arrives: this runs from a click or a scroll, never during a
	// render and never on the server, so there is one place that writes and it
	// cannot run twice for the same slice.
	const loadMore = useCallback(() => {
		if (!state.hasMore || state.isLoadingMore || state.loadMoreFailed) return
		if (!AsyncResult.isSuccess(result)) return
		const live = result.value
		const next: Accumulated<T> = {
			pages: [...acc.pages, live],
			page: advance(acc.page, live.items.length),
		}
		rememberedLists.set(resetKey, next as Accumulated<unknown>)
		setStore({ key: resetKey, acc: next })
	}, [
		state.hasMore,
		state.isLoadingMore,
		state.loadMoreFailed,
		result,
		acc,
		resetKey,
	])

	// Re-asks for the slice that failed and keeps everything already read. The
	// alternative — starting over — would throw away the reader's place for a
	// fault that only affected the last step.
	const retry = refreshCurrent

	const refresh = useCallback(() => {
		rememberedLists.delete(resetKey)
		setStore({ key: resetKey, acc: fresh() })
		refreshFirst()
	}, [resetKey, fresh, refreshFirst])

	return { ...state, loadMore, retry, refresh }
}

/**
 * What the list looks like right now, given the slice in flight and the ones
 * already absorbed.
 *
 * Split out from the hook so every combination is checkable on its own: the
 * difference between "nothing yet" and "more on the way" decides whether the
 * reader sees a spinner in place of the list or keeps reading it, and the
 * difference between the two kinds of failure decides whether the rows in hand
 * survive.
 */
export function readListState<T, E>(input: {
	readonly result: AsyncResult.AsyncResult<PaginatedList<T>, E>
	readonly pages: ReadonlyArray<PaginatedList<T>>
	readonly idOf: (row: T, index: number) => string
}): Omit<InfiniteList<T>, 'loadMore' | 'retry' | 'refresh'> {
	const { result, pages, idOf } = input
	const live = AsyncResult.isSuccess(result) ? result.value : undefined
	const settled = live === undefined ? pages : [...pages, live]

	const items: Array<T> = []
	const seen = new Set<string>()
	let newFromLastPage = 0
	for (const [pageIndex, page] of settled.entries()) {
		const isLast = pageIndex === settled.length - 1
		for (const row of page.items) {
			// The position across the whole list, so a row without an id of its
			// own still gets one nothing else can collide with.
			const id = idOf(row, items.length)
			if (seen.has(id)) continue
			seen.add(id)
			items.push(row)
			if (isLast) newFromLastPage += 1
		}
	}

	// The total is asked for once, on the first slice, and held from whichever
	// slice carried one.
	const counted = settled.find(page => page.total !== null)
	const total = counted?.total ?? undefined

	const last = settled.at(-1)
	const failed = AsyncResult.isFailure(result)
	const hasRows = settled.length > 0
	// A later slice is fetched by an atom of its own, so it reports `Initial`
	// rather than waiting; a retry marks a settled result waiting instead.
	const pending = AsyncResult.isInitial(result) || AsyncResult.isWaiting(result)

	return {
		items,
		total,
		// Four ways a list can be over, and only the last needs the server to
		// have counted anything. The first three are what keep a list that is
		// answering oddly from being asked forever.
		hasMore:
			last !== undefined &&
			last.hasMore &&
			last.items.length > 0 &&
			newFromLastPage > 0 &&
			(total === undefined || items.length < total),
		isLoadingFirstPage: !hasRows && pending,
		isLoadingMore: hasRows && pending,
		isError: failed && !hasRows,
		loadMoreFailed: failed && !pending && hasRows,
	}
}
