import { MotionStyle, MotionValue } from "motion/react"
import { createContext } from "react"

export interface TickerItemContextType {
    offset: MotionValue<number>
    projection: MotionValue<number>
    props: {
        className: string
        style: MotionStyle
        "aria-hidden"?: boolean | undefined
        "aria-posinset"?: number | undefined
        "aria-setsize"?: number | undefined
    }
    itemIndex: number
    cloneIndex: number | undefined
    start: number
    end: number
}

export const TickerItemContext = /** @__PURE__ */ createContext<
    TickerItemContextType | undefined
>(undefined)
