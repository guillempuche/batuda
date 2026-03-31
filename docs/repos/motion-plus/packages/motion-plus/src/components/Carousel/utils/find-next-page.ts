import { wrap } from "motion/react"
import { ItemPosition } from "../../Ticker/types"
import { findCurrentIndexFromInset } from "./find-current-index"

export function findNextItemInset(
    currentInset: number,
    itemPositions: ItemPosition[],
    gap: number,
    targetInset?: number
): number {
    if (itemPositions.length === 0) return 0

    const totalItemLength = itemPositions[itemPositions.length - 1].end
    const wrapInset = totalItemLength + gap
    const idealInset =
        targetInset ?? currentInset + (itemPositions[0]?.end ?? 0)

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

    let index = currentItemIndex + 1
    let nextItemInset = 0
    let hasFoundNextInset = false
    while (!hasFoundNextInset) {
        const { start, end } =
            itemPositions[wrap(0, itemPositions.length, index)]
        const iteration = Math.floor(index / itemPositions.length)
        const transformInset = iteration * wrapInset
        const transformedStart = start + transformInset

        nextItemInset = transformedStart

        if (end + transformInset > idealInset) {
            hasFoundNextInset = true
        } else {
            index++
        }
    }

    return nextItemInset
}

export function findNextPageInset(
    currentInset: number,
    containerLength: number,
    itemPositions: ItemPosition[],
    gap: number
): number {
    const idealInset = currentInset + containerLength
    return findNextItemInset(currentInset, itemPositions, gap, idealInset)
}
