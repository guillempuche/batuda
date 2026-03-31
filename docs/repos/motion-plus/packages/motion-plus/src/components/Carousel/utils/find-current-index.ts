import { ItemPosition } from "../../Ticker/types"

export function findCurrentIndexFromInset(
    currentInset: number,
    itemPositions: ItemPosition[],
    wrapInset: number
): number {
    const iteration = Math.floor(currentInset / wrapInset)
    const transform = iteration * wrapInset

    let itemIndex = 0
    for (let i = 0; i < itemPositions.length; i++) {
        const { end } = itemPositions[i]
        itemIndex = i

        if (end + transform > currentInset) {
            break
        }
    }

    // Return the iteration-adjusted index
    return itemIndex + iteration * itemPositions.length
}
