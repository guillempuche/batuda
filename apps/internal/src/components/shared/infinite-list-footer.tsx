import { useLingui } from '@lingui/react/macro'
import { styled } from 'next-yak'
import { useEffect, useRef } from 'react'

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
	listLabel,
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
	/**
	 * What the rows are, for the count read out loud — "documents", "proposals".
	 * Worth setting wherever two lists share a screen: a bare "showing 40 of 45"
	 * cannot say which of the two it is counting.
	 */
	readonly listLabel?: string
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

	const statusRef = useRef<HTMLSpanElement>(null)
	// Set when the reader pressed the button themselves. The last rows take the
	// button away with them, and whoever was standing on it would otherwise be
	// dropped back to the very top of the page — so they are moved onto the line
	// that says the list is now complete, which is also read out to them.
	const pressedByHand = useRef(false)
	useEffect(() => {
		if (hasMore || !pressedByHand.current) return
		pressedByHand.current = false
		statusRef.current?.focus()
	}, [hasMore])

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

	// Scrolling more rows into view says nothing on its own to somebody who
	// cannot see them arrive, so count them out loud instead. A list that never
	// asked how many there are says only how far it has got, rather than
	// counting up to a blank. A failure is always said, even where the counting
	// is turned off, because nothing else on the page reports it.
	// Written once and used twice, seen and heard, so the two can never drift.
	const failureNote = t`Could not load more. The rows already here are still current.`
	const announcement = loadMoreFailed
		? failureNote
		: !announce
			? ''
			: listLabel === undefined
				? totalCount === undefined
					? t`Showing ${loadedCount}`
					: t`Showing ${loadedCount} of ${totalCount}`
				: totalCount === undefined
					? t`Showing ${loadedCount} ${listLabel}`
					: t`Showing ${loadedCount} of ${totalCount} ${listLabel}`

	return (
		// Stays on the page after the last rows arrive, holding nothing but the
		// spoken count. Taking it away at that moment would drop the reader's
		// place in the page, and would silence the one announcement that says the
		// list is now complete.
		<Footer $collapsed={!hasMore}>
			{hasMore && (
				<>
					<Sentinel ref={sentinelRef} aria-hidden />
					{/* After a failure this re-asks for the slice that failed rather
					    than starting the list over, so a fault on the last step does
					    not cost the reader everything they have already scrolled
					    through. Marked unavailable while a slice is on its way rather
					    than switched off: switching off the button somebody has just
					    pressed takes the keyboard back to the top of the page. */}
					<PriButton
						type='button'
						$variant='outlined'
						onClick={() => {
							if (isLoadingMore) return
							pressedByHand.current = true
							if (loadMoreFailed) retry()
							else loadMore()
						}}
						aria-disabled={isLoadingMore}
						data-testid={`${testId}-load-more`}
					>
						<span>{loadMoreFailed ? t`Try again` : t`Load more`}</span>
					</PriButton>
				</>
			)}
			{/* The line below already reads this same sentence out loud, so this
			    copy is kept silent rather than heard twice. */}
			{loadMoreFailed && <FailureNote aria-hidden>{failureNote}</FailureNote>}
			<SrOnly role='status' ref={statusRef} tabIndex={-1}>
				{announcement}
			</SrOnly>
		</Footer>
	)
}

const Footer = styled.div<{ $collapsed?: boolean }>`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--space-xs);
	padding: ${p => (p.$collapsed ? '0' : 'var(--space-lg) 0')};
	position: relative;

	/* The button is only marked unavailable, never switched off, so the dimmed
	   look has to be drawn here. */
	& [aria-disabled='true'] {
		opacity: 0.5;
		cursor: not-allowed;
	}
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
