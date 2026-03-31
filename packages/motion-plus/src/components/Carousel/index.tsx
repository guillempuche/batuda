"use client"

import { wheel } from "motion-plus-dom"
import {
    animate,
    clamp,
    HTMLMotionProps,
    JSAnimation,
    Transition,
    useMotionValue,
    useMotionValueEvent,
    useTransform,
} from "motion/react"
import { PropsWithChildren, useEffect, useRef, useState } from "react"
import { Ticker } from "../Ticker"
import { useTicker } from "../Ticker/context"
import { getLayoutStrategy } from "../Ticker/utils/layout-strategy"
import { CarouselContext } from "./context"
import { CarouselProps, CarouselViewProps } from "./types"
import { calcCurrentPage } from "./utils/calc-current-page"
import { calcPageInsets } from "./utils/calc-page-insets"
import { findNextPageInset } from "./utils/find-next-page"
import { findPrevPageInset } from "./utils/find-prev-page"

function CarouselView({
    children,
    offset,
    targetOffset,
    tugOffset,
    loop = true,
    transition,
    tickerRef,
    axis = "x",
    snap = "page",
    page,
    wheelSwipeThreshold,
}: PropsWithChildren<
    Omit<HTMLMotionProps<"div">, "children"> & CarouselViewProps
>) {
    /**
     * When this boolean is true, the rendered offset will be "attached" to
     * the target offset, allowing for direct manipulation. When it's false,
     * we're animating the offset to the target offset. This allows things
     * like pagination and pagination progress to be optionally coupled to
     * the target offset.
     */
    const isOffsetAttachedToTarget = useRef(true)

    /**
     * Calculate pagination and inset limits based on the measured
     * ticker and item dimensions.
     */
    const {
        clampOffset,
        totalItemLength,
        itemPositions,
        containerLength,
        gap,
        maxInset,
        direction,
        isMeasured,
    } = useTicker()
    const wrapInset = totalItemLength + gap
    const pagination = calcPageInsets(itemPositions, containerLength, maxInset)
    const totalPages = pagination.insets.length
    const { sign } = getLayoutStrategy(axis, direction)

    /**
     * Set page offset when page prop is provided and measurements are ready.
     * Responds to changes in the page prop.
     */
    const lastPageRef = useRef<number | undefined>(undefined)
    const hasInitialized = useRef(false)

    useEffect(() => {
        if (page === undefined || !isMeasured || totalPages === 0) return

        const pageIndex = clamp(0, totalPages - 1, page)
        const newOffset = -pagination.insets[pageIndex] * sign

        if (!hasInitialized.current) {
            // First time: jump to position without animation
            hasInitialized.current = true
            lastPageRef.current = page
            targetOffset.jump(newOffset)
            offset.jump(newOffset)
        } else if (lastPageRef.current !== page) {
            // Page prop changed: jump to new position
            lastPageRef.current = page
            targetOffset.jump(newOffset)
            offset.jump(newOffset)
        }
    }, [isMeasured, totalPages, page, sign, targetOffset, offset, pagination.insets])

    /**
     * Helper function to calculate pagination state based on target offset
     */
    const calculatePaginationState = (targetOffsetValue: number) => {
        const current = calcCurrentPage(
            targetOffsetValue * sign,
            pagination.insets,
            wrapInset,
            maxInset
        )
        const isNextActive = loop ? true : targetOffsetValue * -sign < maxInset!
        const isPrevActive = loop ? true : targetOffsetValue * -sign > 0

        return { current, isNextActive, isPrevActive }
    }

    // Initialize pagination state with current target offset
    const [paginationState, setPaginationState] = useState(() =>
        calculatePaginationState(targetOffset.get())
    )

    // Update the pagination state when the measured ticker dimensions change
    useEffect(() => {
        updatePaginationState()
    }, [containerLength, totalItemLength])

    const updatePaginationState = () => {
        /**
         * We derive the current page from the target offset, not the currently-rendered
         * offset. This ensures that if we're paginating discretely, the page indicator
         * updates immediately, and if we're jumping many pages that any indicator like a dots
         * indicator doesn't appear to animate through many dots as the carousel animates.
         */
        const newPaginationState = calculatePaginationState(targetOffset.get())

        // Only update state if something has changed
        if (
            newPaginationState.current !== paginationState.current ||
            newPaginationState.isNextActive !== paginationState.isNextActive ||
            newPaginationState.isPrevActive !== paginationState.isPrevActive
        ) {
            setPaginationState(newPaginationState)
        }
    }

    /**
     * Handle changes to the target offset.
     * - Update the rendered offset.
     * - Update pagination state.
     */
    useMotionValueEvent(targetOffset, "change", (latest) => {
        offset.set(latest)
        updatePaginationState()
    })

    /**
     * Attach the rendered offset to the target offset.
     */
    const currentAnimation = useRef<ReturnType<typeof animate> | null>(null)
    const stopOffsetAnimation = () => {
        if (!currentAnimation.current) return
        currentAnimation.current.stop()
        currentAnimation.current = null
    }

    /**
     * Add a custom handler to the offset motion value. We link offset to targetOffset
     * and only update targetOffset from pagination/gestures. When offset is attached
     * to targetOffset, changes are passed straight through to offset. When it's not
     * attached, we animate offset to the latest targetOffset value.
     */
    useEffect(() => {
        offset.attach((v, onUpdate) => {
            stopOffsetAnimation()

            if (isOffsetAttachedToTarget.current) {
                onUpdate(v)
            } else {
                currentAnimation.current = new JSAnimation({
                    keyframes: [offset.get(), v],
                    velocity: clamp(-2000, 2000, offset.getVelocity()),
                    ...transition,
                    onUpdate,
                    onComplete: () => {
                        currentAnimation.current = null
                    },
                })
            }

            isOffsetAttachedToTarget.current = true
        }, stopOffsetAnimation)
    }, [])

    /**
     * Discrete pagination. Support (and pass via context) next/prev/goto
     * functions.
     */
    const stepOffset = (newOffset: number) => {
        const clampedOffset = clampOffset(newOffset)
        targetOffset.stop()
        isOffsetAttachedToTarget.current = false
        targetOffset.set(clampedOffset * sign)
    }

    const paginate = (
        findPageInset: typeof findNextPageInset,
        direction: 1 | -1
    ) => {
        const offset = -findPageInset(
            -targetOffset.get() * sign,
            pagination.visibleLength,
            itemPositions,
            gap
        )

        const clamped = clampOffset(offset)

        if (clamped * sign === targetOffset.get()) {
            animate(tugOffset, 0, {
                velocity: direction * sign * 400,
                ...limitSpring,
            })
        } else {
            stepOffset(clamped)
        }
    }

    const nextPage = () => paginate(findNextPageInset, -1)
    const prevPage = () => paginate(findPrevPageInset, 1)

    const gotoPage = (i: number) => {
        const iteration = loop
            ? Math.floor((-targetOffset.get() * sign) / wrapInset)
            : 0
        console.log({ iteration })
        const transformOffset = iteration * -wrapInset
        stepOffset(-pagination.insets[i] + transformOffset)
    }

    /**
     * Wheel input. Support direct wheel manipulation and, when snap is
     * enabled, swipe pagination.
     */
    const wheelCallbacks = useRef({
        nextPage,
        prevPage,
        clampOffset,
    })

    useEffect(() => {
        wheelCallbacks.current = {
            nextPage,
            prevPage,
            clampOffset,
        }
    }, [nextPage, prevPage, clampOffset])

    useEffect(() => {
        const element = tickerRef.current
        if (!element) return

        return wheel(element, {
            axis,
            swipeThreshold: wheelSwipeThreshold,
            onSwipe: snap
                ? (direction) => {
                      const { nextPage, prevPage } = wheelCallbacks.current
                      direction * sign === 1 ? nextPage() : prevPage()
                  }
                : undefined,
            onWheel: (delta) => {
                const { clampOffset } = wheelCallbacks.current

                const newOffset = offset.get() + delta
                const clampedOffset =
                    sign > 0
                        ? clampOffset(newOffset)
                        : clamp(0, maxInset!, newOffset)
                targetOffset.jump(maxInset ? clampedOffset : newOffset)
            },
        })
    }, [axis, snap, offset, sign])

    return (
        <CarouselContext.Provider
            value={{
                currentPage: paginationState.current,
                isNextActive: paginationState.isNextActive,
                isPrevActive: paginationState.isPrevActive,
                totalPages,
                nextPage,
                prevPage,
                gotoPage,
                offset,
                targetOffset,
            }}
        >
            {children}
        </CarouselContext.Provider>
    )
}

export function Carousel({
    children,
    loop = true,
    transition = defaultTransition,
    axis = "x",
    snap = "page",
    page,
    wheelSwipeThreshold,
    ...props
}: PropsWithChildren<HTMLMotionProps<"div"> & CarouselProps>) {
    const ref = useRef<HTMLDivElement>(null)
    const targetOffset = useMotionValue(0)
    const offset = useMotionValue(0)
    const tugOffset = useMotionValue(0)
    const renderedOffset = useTransform(() => tugOffset.get() + offset.get())

    return (
        <Ticker
            role="region"
            aria-roledescription="carousel"
            offset={renderedOffset}
            loop={loop}
            ref={ref}
            axis={axis}
            drag={axis}
            _dragX={axis === "x" ? targetOffset : false}
            _dragY={axis === "y" ? targetOffset : false}
            snap={snap}
            pageTransition={transition}
            {...props}
        >
            <CarouselView
                tickerRef={ref}
                loop={loop}
                offset={offset}
                tugOffset={tugOffset}
                targetOffset={targetOffset}
                transition={transition}
                snap={snap}
                axis={axis}
                page={page}
                wheelSwipeThreshold={wheelSwipeThreshold}
            >
                {children}
            </CarouselView>
        </Ticker>
    )
}

const defaultTransition: Transition = {
    type: "spring",
    stiffness: 200,
    damping: 40,
}

const limitSpring: Transition = {
    type: "spring",
    stiffness: 80,
    damping: 10,
}
