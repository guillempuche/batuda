import { useLingui } from '@lingui/react/macro'
import { useEffect, useRef } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { useOptionalBlueprintViewportRef } from '#/components/layout/blueprint-sheet'
import { SrOnly } from '#/components/shared/sr-only'
import type { InfiniteList } from '#/hooks/use-infinite-list'

/**
 * How far past the end of the visible area the next rows start loading. Far
 * enough that they are usually already there by the time the reader gets to
 * the bottom, so the list reads as continuous rather than as a series of
 * waits.
 */
const PREFETCH_MARGIN_PX = 600

/**
 * The end of a list that keeps going.
 *
 * Two ways to reach the next rows, on purpose. Scrolling near the end loads
 * them without being asked, which is what nearly everyone will do — and a
 * real button stays in the markup for everyone who never triggers that:
 * people moving through the page by keyboard, anyone using a screen reader,
 * and any browser where the observer does not fire. Auto-loading alone would
 * simply strand them at the first page.
 */
export function InfiniteListFooter({
	list,
	testId,
	announce = true,
}: {
	readonly list: InfiniteList<unknown>
	/** Names the button, for tests: `<testId>-load-more`. */
	readonly testId: string
	/**
	 * Whether to count the rows out loud as they arrive. Turn it off where the
	 * screen already says the same thing — a page that announces its own list,
	 * or a board where one footer per column would say it eight times at once.
	 */
	readonly announce?: boolean
}) {
	const { t } = useLingui()
	const sentinelRef = useRef<HTMLDivElement>(null)
	const viewportRef = useOptionalBlueprintViewportRef()

	const { hasMore, isLoadingMore, loadMoreFailed, loadMore, retry } = list
	const loadedCount = list.items.length
	// Named rather than read inline so the announcement reaches translators with
	// two named blanks to place, instead of one named and one numbered.
	const totalCount = list.total

	// Held in a ref so the watcher below is not torn down and set up again every
	// time the list grows.
	const onReach = useRef(loadMore)
	onReach.current = loadMore

	const canAutoLoad = hasMore && !isLoadingMore && !loadMoreFailed
	useEffect(() => {
		const sentinel = sentinelRef.current
		if (!sentinel || !canAutoLoad) return
		// Read the scroller now rather than when the sheet mounted: which element
		// owns the scrolling changes with the width of the window, and a stale one
		// would measure the load-early margin against nothing. Falling back to null
		// watches the page, which is what phones scroll.
		const sheetViewport = viewportRef?.current ?? null
		const scrollRoot =
			sheetViewport !== null &&
			sheetViewport.scrollHeight > sheetViewport.clientHeight
				? sheetViewport
				: null
		const observer = new IntersectionObserver(
			entries => {
				if (entries.some(entry => entry.isIntersecting)) onReach.current()
			},
			{ root: scrollRoot, rootMargin: `0px 0px ${PREFETCH_MARGIN_PX}px 0px` },
		)
		observer.observe(sentinel)
		return () => observer.disconnect()
	}, [canAutoLoad, viewportRef])

	if (!hasMore) return null

	return (
		<Footer>
			<Sentinel ref={sentinelRef} aria-hidden />
			{/* After a failure this re-asks for the slice that failed rather than
			    starting the list over, so a fault on the last step does not cost
			    the reader everything they have already scrolled through. */}
			<PriButton
				type='button'
				$variant='outlined'
				onClick={loadMoreFailed ? retry : loadMore}
				disabled={isLoadingMore}
				data-testid={`${testId}-load-more`}
			>
				<span>{loadMoreFailed ? t`Try again` : t`Load more`}</span>
			</PriButton>
			{loadMoreFailed && (
				<FailureNote role='status'>
					{t`Could not load more. The rows already here are still current.`}
				</FailureNote>
			)}
			{/* Scrolling more rows into view says nothing on its own to somebody
			    who cannot see them arrive, so count them out loud instead. A list
			    that never asked how many there are says only how far it has got,
			    rather than counting up to a blank. */}
			{announce &&
				(totalCount === undefined ? (
					<SrOnly aria-live='polite'>{t`Showing ${loadedCount}`}</SrOnly>
				) : (
					<SrOnly aria-live='polite'>
						{t`Showing ${loadedCount} of ${totalCount}`}
					</SrOnly>
				))}
		</Footer>
	)
}

const Footer = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-lg) 0;
	position: relative;
`

// Sits above the button so the next rows are already on their way by the time
// the button itself would come into view.
const Sentinel = styled.div`
	position: absolute;
	top: 0;
	height: 1px;
	width: 100%;
	pointer-events: none;
`

const FailureNote = styled.p`
	margin: 0;
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-small-size);
	text-align: center;
`
