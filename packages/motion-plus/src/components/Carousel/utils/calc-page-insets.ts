import { ItemPosition } from "../../Ticker/types"

export function calcPageInsets(
    itemPositions: ItemPosition[],
    containerLength: number,
    maxInset: number | null,
    allowRescale: boolean = true
): { insets: number[]; visibleLength: number } {
    const pageInsetData = { insets: [], visibleLength: containerLength }

    if (itemPositions.length === 0) {
        return pageInsetData
    }

    const insets = [itemPositions[0].start]

    /**
     * Loop through items and decide whether they've passed the
     * threshold of a new page.
     */
    for (let i = 1; i < itemPositions.length; i++) {
        const { start, end } = itemPositions[i]

        /**
         * If the end of this item is greater than the last
         * page inset plus the container length, we need to
         * add a new page inset.
         */
        if (insets[insets.length - 1] + containerLength < end) {
            /**
             * If we have a maxInset, it means looping is disabled and
             * therefore we need bail if the we're beyond the maxInset
             * (as this will align the final item with the end of the container)
             */
            if (maxInset !== null) {
                if (start <= maxInset) {
                    insets.push(start)
                } else {
                    // If start > maxInset, add maxInset as the final offset
                    insets.push(maxInset)
                    break // Don't add any more insets
                }
            } else {
                insets.push(start)
            }
        }
    }

    /**
     * If we're not looping, we want to check the size of the final page vs
     * the average page size. If the final page is less than half the average,
     * we attempt to redistribute by using a shorter container length.
     */
    if (allowRescale && maxInset !== null && insets.length > 1) {
        // Store the original insets before adding maxInset
        const originalLastInset = insets[insets.length - 1]

        // Calculate average page size (using actual page breaks, not including potential maxInset)
        const pageSizes = []
        for (let i = 0; i < insets.length - 1; i++) {
            pageSizes.push(insets[i + 1] - insets[i])
        }
        const averagePageSize =
            pageSizes.reduce((sum, size) => sum + size, 0) / pageSizes.length

        // Calculate the size of the final page (from last actual page break to maxInset)
        const finalPageSize = maxInset - originalLastInset
        // If final page is less than half the average, try to redistribute
        if (finalPageSize < averagePageSize * 0.5) {
            const scaledPagination = calcPageInsets(
                itemPositions,
                containerLength * 0.75,
                maxInset,
                false
            )

            // If we still get the same number of actual page breaks, use the redistributed version
            if (scaledPagination.insets.length === insets.length) {
                return scaledPagination
            }
        }
    }

    return {
        insets,
        visibleLength: containerLength,
    }
}
