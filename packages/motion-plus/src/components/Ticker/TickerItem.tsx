"use client"

import {
    HTMLMotionProps,
    motion,
    MotionValue,
    useTransform,
} from "motion/react"
import { useTicker } from "./context"
import { TickerItemContext } from "./TickerItemContext"
import { useTickerItem } from "./use-ticker-item"
import { getLayoutStrategy } from "./utils/layout-strategy"

export type ItemSize = "auto" | "fill" | "manual"

/**
 * Represents an individual item within the Ticker.
 *
 * This component handles the logic for repositioning items to create the infinite scroll effect.
 *
 * @param offset - The current scroll offset of the ticker.
 * @param axis - The scroll axis ("x" or "y").
 * @param listSize - The total size of the list including all clones.
 * @param itemIndex - The original index of the item.
 * @param cloneIndex - The index of the clone, if this is a cloned item.
 * @param props - HTML attributes to pass to the list item li element.
 * @returns A ListItem React component.
 */
export function TickerItemWrapper({
    children,
    offset,
    axis,
    listSize = 0,
    numItems = 0,
    itemIndex,
    cloneIndex,
    bounds,
    alignItems,
    reproject = true,
    size = "auto",
    safeMargin,
}: HTMLMotionProps<"li"> & {
    offset: MotionValue<number>
    axis: "x" | "y"
    listSize?: number
    bounds: { start: number; end: number }
    numItems: number
    itemIndex: number
    cloneIndex?: number
    alignItems: "flex-start" | "center" | "flex-end" | "stretch"
    size?: ItemSize
    safeMargin: number
    reproject?: boolean
    children: React.ReactNode
}) {
    const { start, end } = bounds
    const { visibleLength, direction, inset } = useTicker()
    const { sign } = getLayoutStrategy(axis, direction)

    const projection = useTransform(() => {
        if (!reproject) return 0

        const currentOffset = offset.get()
        if ((!start && !end) || !listSize) return 0

        if (currentOffset * sign + bounds.end <= -inset - safeMargin) {
            return listSize * sign
        }

        /**
         * If we've defined a safeMargin, also project items backwards if they
         * fall outside the right boundary (+ margin). This fills-in the start area
         * without affecting the alignment of items.
         */
        if (safeMargin > 0) {
            const rightBoundary = visibleLength - safeMargin - inset
            if (currentOffset * sign + bounds.start >= rightBoundary) {
                return -listSize * sign
            }
        }

        return 0
    })

    const itemOffset = useTransform(() => {
        const currentOffset = offset.get()
        const currentTransform = projection.get()
        if ((!start && !end) || !listSize) return 0

        return currentOffset * sign + start + currentTransform * sign
    })

    const ariaProps =
        cloneIndex === undefined
            ? {
                  ["aria-hidden"]: false,
                  ["aria-posinset"]: itemIndex + 1,
                  ["aria-setsize"]: numItems,
              }
            : {
                  ["aria-hidden"]: true,
              }

    const isFill = size === "fill"
    const offAxisSize = alignItems === "stretch" ? "100%" : "fit-content"

    const props = {
        className: cloneIndex === undefined ? "ticker-item" : "clone-item",
        style: {
            flexGrow: 0,
            flexShrink: 0,
            position: "relative",
            flexBasis: size === "fill" ? "100%" : undefined,
            display: isFill ? "grid" : undefined,
            gridTemplateColumns: isFill ? "1fr" : undefined,
            gridTemplateRows: isFill ? "1fr" : undefined,
            minWidth: isFill ? 0 : undefined,
            minHeight: isFill ? 0 : undefined,
            height: axis === "x" ? offAxisSize : undefined,
            width: axis === "y" ? offAxisSize : undefined,
            x: axis === "x" ? projection : 0,
            y: axis === "y" ? projection : 0,
        },
        ...ariaProps,
    } as const

    return (
        <TickerItemContext.Provider
            value={{
                start,
                end,
                offset: itemOffset,
                projection,
                itemIndex,
                cloneIndex,
                props,
            }}
        >
            {size === "manual" ? (
                children
            ) : (
                <DefaultTickerItem>{children}</DefaultTickerItem>
            )}
        </TickerItemContext.Provider>
    )
}

export function DefaultTickerItem({ children }: { children: React.ReactNode }) {
    const { props } = useTickerItem()

    return <motion.li {...props}>{children}</motion.li>
}
