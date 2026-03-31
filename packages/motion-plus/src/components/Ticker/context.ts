import { invariant } from "motion-utils"
import { MotionValue } from "motion/react"
import { createContext, useContext } from "react"
import { TickerState } from "./types"

export interface TickerInfo extends TickerState {
    gap: number
    clampOffset: (offset: number) => number
    offset: MotionValue<number>
    renderedOffset: MotionValue<number>
}

export const TickerContext = /** @__PURE__ */ createContext<TickerInfo | null>(
    null
)

export function useTicker(): TickerInfo {
    const context = useContext(TickerContext)

    invariant(
        Boolean(context),
        "useTicker must be used within a Ticker component"
    )

    return context as TickerInfo
}
