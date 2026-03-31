import { invariant } from "motion-utils"
import { MotionValue } from "motion/react"
import { createContext, useContext } from "react"

export interface CarouselInfo {
    currentPage: number
    totalPages: number
    nextPage: VoidFunction
    prevPage: VoidFunction
    isNextActive: boolean
    isPrevActive: boolean
    gotoPage: (page: number) => void
    offset: MotionValue<number>
    targetOffset: MotionValue<number>
}

export const CarouselContext =
    /** @__PURE__ */ createContext<CarouselInfo | null>(null)

export function useCarousel(): CarouselInfo {
    const context = useContext(CarouselContext)

    invariant(
        Boolean(context),
        "useCarousel must be used within a Carousel component"
    )

    return context as CarouselInfo
}
