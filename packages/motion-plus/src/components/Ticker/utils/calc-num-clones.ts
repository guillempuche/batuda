import { ItemPosition } from "../types"
import { calcItemLength, calcTotalItemLength } from "./calc-total-item-length"

export function calcNumClones(
    visibleLength: number,
    itemPositions: ItemPosition[],
    gap: number
) {
    const totalItemLength = calcTotalItemLength(itemPositions)
    const maxItemLength = Math.max(...itemPositions.map(calcItemLength))

    let count = 0

    /**
     * A length where the largest item is out of the visible area.
     */
    let safeFillLength = 0

    while (safeFillLength < visibleLength) {
        safeFillLength = (totalItemLength + gap) * (count + 1) - maxItemLength
        count++
    }

    return Math.max(count - 1, 0)
}
