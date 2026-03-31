import { HTMLElements, MotionValue } from "motion/react"
import { TickerProps } from "../Ticker"

export interface CarouselProps<TagName extends keyof HTMLElements = "div">
    extends Omit<
        TickerProps<TagName>,
        "velocity" | "offset" | "hoverFactor" | "pageTransition"
    > {
    /**
     * The snap type to use for the carousel while
     * free-scrolling.
     *
     * - "page" - Snap to the next or previous page of items.
     * - "loose" - Use normal scroll momentum, resting on the closest item to the natural scroll resting point.
     * - false - No snapping.
     *
     * @default: "page"
     */
    snap?: "page" | "loose" | false

    /**
     * The initial page to display when the carousel mounts.
     * Pages are calculated based on item positions and container size.
     */
    page?: number

    /**
     * The amount of accumulated scroll delta (in pixels) required
     * to trigger a page swipe via the mouse wheel.
     *
     * @default 100
     */
    wheelSwipeThreshold?: number
}

export interface CarouselViewProps {
    /**
     * A ref to the rendered ticker container element.
     */
    tickerRef: React.RefObject<HTMLElement | null>

    loop: CarouselProps["loop"]
    axis: CarouselProps["axis"]
    snap: CarouselProps["snap"]
    page: CarouselProps["page"]
    wheelSwipeThreshold: CarouselProps["wheelSwipeThreshold"]

    /**
     * The rendered offset for the underlying ticker.
     */
    offset: MotionValue<number>

    /**
     * The target offset for the offset - this can be
     * coupled and decoupled during interaction with
     * the carousel and its pagination controls.
     */
    targetOffset: MotionValue<number>

    tugOffset: MotionValue<number>
}
