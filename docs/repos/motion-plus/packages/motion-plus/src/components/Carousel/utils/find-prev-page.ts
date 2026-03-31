import { wrap } from "motion/react"
import { ItemPosition } from "../../Ticker/types"
import { findCurrentIndexFromInset } from "./find-current-index"

export function findPrevItemInset(
    currentInset: number,
    itemPositions: ItemPosition[],
    gap: number,
    targetInset?: number,
    containerLength?: number
): number {
    if (itemPositions.length === 0) return 0

    const totalItemLength = itemPositions[itemPositions.length - 1].end
    const wrapInset = totalItemLength + gap
    const idealInset = targetInset ?? currentInset - (containerLength ?? 0)

    /**
     * First, find the index of the item closest to the current
     * inset. We do this to ensure we paginate by at least one
     * item in the event that the items are larger than the
     * viewable container.
     */
    const currentItemIndex = findCurrentIndexFromInset(
        currentInset,
        itemPositions,
        wrapInset
    )

    let index = currentItemIndex
    let prevItemInset = currentInset
    let hasFoundPrevInset = false
    while (!hasFoundPrevInset) {
        const { start, end } =
            itemPositions[wrap(0, itemPositions.length, index)]
        const itemSize = end - start
        const iteration = Math.floor(index / itemPositions.length)
        const transformInset = iteration * wrapInset
        const transformedStart = start + transformInset

        if (
            idealInset <= transformedStart + gap ||
            transformedStart >= currentInset
        ) {
            prevItemInset = transformedStart
            index--
        } else if (idealInset <= transformedStart) {
            prevItemInset = transformedStart
            hasFoundPrevInset = true
        } else {
            if (
                (containerLength && itemSize > containerLength) ||
                (prevItemInset === currentInset &&
                    idealInset >= transformedStart)
            ) {
                prevItemInset = transformedStart
            }
            hasFoundPrevInset = true
        }
    }

    return prevItemInset
}

export function findPrevPageInset(
    currentInset: number,
    containerLength: number,
    itemPositions: ItemPosition[],
    gap: number
): number {
    const idealInset = currentInset - containerLength
    return findPrevItemInset(
        currentInset,
        itemPositions,
        gap,
        idealInset,
        containerLength
    )
}
