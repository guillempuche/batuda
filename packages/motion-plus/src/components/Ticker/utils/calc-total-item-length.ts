import { ItemPosition } from "../types"

export function calcItemLength(itemPosition: ItemPosition) {
    return itemPosition.end - itemPosition.start
}

export function calcTotalItemLength(itemPositions: ItemPosition[]) {
    return itemPositions[itemPositions.length - 1].end - itemPositions[0].start
}
