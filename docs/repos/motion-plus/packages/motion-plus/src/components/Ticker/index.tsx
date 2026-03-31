"use client"

import {
    animate,
    clamp,
    frame,
    HTMLElements,
    LayoutGroup,
    motion,
    MotionValue,
    noop,
    PanInfo,
    resize,
    Transition,
    useAnimationFrame,
    useComposedRefs,
    useInView,
    useIsomorphicLayoutEffect,
    useMotionValue,
    useMotionValueEvent,
    usePageInView,
    useReducedMotion,
    useTransform,
    wrap,
} from "motion/react"
import React, {
    forwardRef,
    PropsWithChildren,
    useCallback,
    useMemo,
    useRef,
    useState,
} from "react"
import { findNextItemInset } from "../Carousel/utils/find-next-page"
import { findPrevItemInset } from "../Carousel/utils/find-prev-page"
import { TickerContext } from "./context"
import { ItemSize, TickerItemWrapper } from "./TickerItem"
import { ItemPosition, TickerState } from "./types"
import { useFocusNavigation } from "./use-focus-navigation"
import { calcNumClones } from "./utils/calc-num-clones"
import { calcTotalItemLength } from "./utils/calc-total-item-length"
import { getLayoutStrategy } from "./utils/layout-strategy"

/**
 * Props for the Ticker component.
 */
export interface TickerProps<TagName extends keyof HTMLElements = "div"> {
    /**
     * An array of React nodes to be rendered as ticker items.
     */
    items: React.ReactNode[]

    /**
     * The axis along which the ticker scrolls.
     *
     * @default "x"
     */
    axis?: "x" | "y"

    /**
     * The velocity of the ticker scroll in pixels per second. Defaults to 50.
     */
    velocity?: number // pixels per second

    /**
     * Factor by which the velocity is multiplied when the ticker is hovered. Defaults to 1 (no change).
     */
    hoverFactor?: number // 0-1

    /**
     * The gap between ticker items in pixels. Defaults to 10.
     */
    gap?: number // gap between items

    /**
     * Alignment of items within the ticker. Defaults to "center".
     */
    align?: "start" | "center" | "end" | "stretch"

    /**
     * An optional MotionValue to control the ticker's offset externally.
     */
    offset?: MotionValue<number>

    /**
     * Whether the ticker should be static. This is a display mode suitable for
     * design canvases that disables animations, measurements and viewport tracking.
     * Defaults to false. **Must** remain static for the duration of the component's lifecycle.
     */
    isStatic?: boolean

    /**
     * The size of the ticker items.
     *
     * @default "auto"
     */
    itemSize?: ItemSize

    /**
     * Show items that overflow the container.
     *
     * @default false
     */
    overflow?: boolean

    /**
     * Allow the carousel to loop through its items.
     * If this is disabled, the carousel will not clone
     * any additional children.
     *
     * @default true
     */
    loop?: boolean

    /**
     * By default, ticker items that disappear off the start of the visible area
     * will be reprojected to the end of the ticker items to reduce or eliminate
     * cloned items.
     *
     * The calculation for this is based on an item's layout. If for some reason
     * the item is transformed back within the visible area, this reprojection
     * might be visible. By setting a safe margin, you can extend the effective
     * visible area.
     *
     * @default 0
     */
    safeMargin?: number

    /**
     * The element type to render as the root container. Defaults to "div".
     */
    as?: TagName

    /**
     * The length of the fade at each end of the container.
     *
     * When looping is disabled, the fade will automatically animate
     * away when the content is scrolled to each end of the container.
     *
     * @default 0
     */
    fade?: number | `${number}%`

    /**
     * The transition to use when fading the edges of the container.
     *
     * @default { duration: 0.2, ease: "linear" }
     */
    fadeTransition?: Transition

    /**
     * The transition to use when paginating the container.
     *
     * @default { type: "spring", stiffness: 400, damping: 40 }
     */
    pageTransition?: Transition
}

const alignAlias = {
    start: "flex-start",
    end: "flex-end",
} as const

/**
 * A performant, accessible, and infinitely scrolling ticker component.
 */
function TickerComponent<TagName extends keyof HTMLElements = "div">(
    {
        items,
        velocity = 50,
        hoverFactor = 1,
        gap = 10,
        axis = "x",
        align = "center",
        offset,
        isStatic = false,
        itemSize = "auto",
        overflow = false,
        loop = true,
        children,
        as = "div" as TagName,
        snap,
        safeMargin = 0,
        fade = 0,
        fadeTransition,
        pageTransition,
        ...props
    }: TickerProps<TagName> & PropsWithChildren & Record<string, any>,
    ref: React.Ref<HTMLElement>
) {
    const internalContainerRef = useRef<HTMLElement>(null)
    const containerRef = useComposedRefs(ref, internalContainerRef)
    const listRef = useRef<HTMLUListElement>(null)
    const [state, setState] = useState<TickerState>({
        direction: "ltr",
        visibleLength: 0,
        inset: 0,
        totalItemLength: 0,
        containerLength: 0,
        itemPositions: [],
        isMeasured: false,
        maxInset: null,
    })

    const alignItems = alignAlias[align as keyof typeof alignAlias] || align
    const { sign } = getLayoutStrategy(axis, state.direction)

    if (isStatic) {
        const renderedOffset = useMotionValue(0)
        return (
            <TickerContext.Provider
                value={{ ...state, gap, clampOffset: noop, offset: renderedOffset, renderedOffset }}
            >
                <ListView<TagName>
                    containerProps={props}
                    containerRef={containerRef}
                    children={children}
                    gap={gap}
                    axis={axis}
                    alignItems={alignItems}
                    offset={renderedOffset}
                    renderedOffset={renderedOffset}
                    items={items}
                    itemSize={itemSize}
                    state={state}
                    overflow={overflow}
                    safeMargin={safeMargin}
                    isStatic
                    as={as}
                    fade={fade}
                    sign={sign}
                />
            </TickerContext.Provider>
        )
    }

    const [hasFocus, setHasFocus] = useState(false)

    const velocityFactor = useMotionValue(1)
    const defaultOffset = useMotionValue(0)
    offset ??= defaultOffset

    const wrappedOffset = useTransform(() => {
        // TODO: Move to strategy
        if (state.direction === "rtl") {
            return wrap(
                state.totalItemLength + gap + state.inset,
                state.inset,
                offset.get()
            )
        }
        return wrap(
            -state.totalItemLength - gap - state.inset,
            -state.inset,
            offset.get()
        )
    })
    const focusOffset = useMotionValue(0)

    const renderedOffset = hasFocus
        ? focusOffset
        : loop
        ? wrappedOffset
        : offset

    const isInViewport = useInView(internalContainerRef, { margin: "100px" })
    const isPageInView = usePageInView()
    const isInView = isInViewport && isPageInView
    const isReducedMotion = useReducedMotion()

    const updateMeasurements = () => {
        if (!internalContainerRef.current || !listRef.current) return

        const direction = window.getComputedStyle(internalContainerRef.current)
            .direction as "ltr" | "rtl"
        const {
            measureItem,
            lengthProp,
            viewportLengthProp,
            getCumulativeInset,
        } = getLayoutStrategy(axis, direction)

        const paddingStartProp = axis === "x" ? "paddingLeft" : "paddingTop"
        const paddingEndProp = axis === "x" ? "paddingRight" : "paddingBottom"

        const container = internalContainerRef.current
        const list = listRef.current
        const allItems = list.querySelectorAll(".ticker-item")

        if (!allItems.length) return

        let hasItemSizeChanged = false
        const itemPositions: ItemPosition[] = []

        for (let i = 0; i < allItems.length; i++) {
            const size = measureItem(allItems[i] as HTMLElement, container)
            itemPositions.push(size)

            const prevSize = state.itemPositions[i]
            if (
                !prevSize ||
                size.start !== prevSize.start ||
                size.end !== prevSize.end
            ) {
                hasItemSizeChanged = true
            }
        }

        /**
         * Cap to viewport size to prevent infinite or wasteful cloning in the event that the
         * container width is reactive to the number of children rendered within it.
         */
        const containerLength = Math.min(
            container[lengthProp],
            window[viewportLengthProp]
        )

        let visibleLength = overflow
            ? window[viewportLengthProp]
            : containerLength

        if (safeMargin > 0) {
            visibleLength += safeMargin * 2
        }

        const totalItemLength = calcTotalItemLength(itemPositions)

        const computedContainerStyle = window.getComputedStyle(container)
        const containerPaddingStart = parseInt(
            computedContainerStyle[paddingStartProp] ?? 0
        )
        const containerPaddingEnd = parseInt(
            computedContainerStyle[paddingEndProp] ?? 0
        )

        const inset = overflow
            ? getCumulativeInset(allItems[0] as HTMLElement)
            : containerPaddingStart

        const maxInset =
            loop === false
                ? Math.max(
                      0,
                      totalItemLength -
                          containerLength +
                          containerPaddingStart +
                          containerPaddingEnd
                  )
                : null

        if (
            visibleLength !== state.visibleLength ||
            totalItemLength !== state.totalItemLength ||
            inset !== state.inset ||
            state.itemPositions.length !== itemPositions.length ||
            hasItemSizeChanged
        ) {
            setState({
                direction,
                visibleLength,
                itemPositions,
                totalItemLength,
                inset,
                containerLength,
                maxInset,
                isMeasured: true,
            })
        }
    }

    useIsomorphicLayoutEffect(() => {
        if (!isInView || !internalContainerRef.current) return
        updateMeasurements()

        const trackViewport = overflow ? resize(updateMeasurements) : undefined

        const trackContainer = resize(
            internalContainerRef.current,
            updateMeasurements
        )

        return () => {
            trackViewport?.()
            trackContainer()
        }
    }, [items, isInView, overflow])

    const isMeasured = state.totalItemLength > 0

    useAnimationFrame(
        isMeasured && isInView && offset === defaultOffset && !isReducedMotion
            ? (_, delta) => {
                  const frameOffset =
                      (delta / 1000) * (velocity * sign * velocityFactor.get())
                  offset.set(offset.get() - frameOffset)
              }
            : noop
    )

    const cloneCount = useMemo(() => {
        if (!isMeasured || !state.visibleLength) return 0

        return calcNumClones(state.visibleLength, state.itemPositions, gap)
    }, [isMeasured, state])

    const totalListSize =
        state.totalItemLength === 0
            ? 0
            : (state.totalItemLength + gap) * (cloneCount + 1)

    const clonedItemGroups: React.ReactNode[] = []

    if (loop) {
        for (let i = 0; i < cloneCount; i++) {
            const clonedItems: React.ReactNode[] = []
            items.forEach((item, itemIndex) => {
                const originalBounds = state.itemPositions[itemIndex]
                const cloneOffset = (state.totalItemLength + gap) * (i + 1)
                const cloneBounds = originalBounds
                    ? {
                          start: originalBounds.start + cloneOffset,
                          end: originalBounds.end + cloneOffset,
                      }
                    : defaultBounds

                clonedItems.push(
                    <TickerItemWrapper
                        key={`clone-${i}-${itemIndex}`}
                        offset={renderedOffset}
                        axis={axis}
                        listSize={totalListSize}
                        itemIndex={itemIndex}
                        cloneIndex={itemIndex}
                        bounds={cloneBounds}
                        alignItems={alignItems}
                        size={itemSize}
                        safeMargin={safeMargin}
                        numItems={items.length}
                    >
                        {item}
                    </TickerItemWrapper>
                )
            })

            const id = `ticker-group-${i}`
            clonedItemGroups.push(
                <LayoutGroup key={id} id={id}>
                    {clonedItems}
                </LayoutGroup>
            )
        }
    }

    useFocusNavigation(
        internalContainerRef,
        axis,
        focusOffset,
        offset,
        setHasFocus
    )

    const clampOffset = useCallback(
        (offset: number) => {
            return state.maxInset !== null
                ? clamp(-state.maxInset, 0, offset)
                : offset
        },
        [state.maxInset]
    )

    return (
        <TickerContext.Provider
            value={{ ...state, gap, clampOffset, offset, renderedOffset }}
        >
            <ListView<TagName>
                containerProps={props}
                children={children}
                containerRef={containerRef}
                listRef={listRef}
                gap={gap}
                axis={axis}
                alignItems={alignItems}
                isMeasured={isMeasured}
                isInView={isInView}
                offset={offset}
                renderedOffset={renderedOffset}
                items={items}
                itemSize={itemSize}
                clonedItems={clonedItemGroups}
                clampOffset={clampOffset}
                snap={snap}
                safeMargin={safeMargin}
                onPointerEnter={() => {
                    animate(velocityFactor, hoverFactor)
                }}
                onPointerLeave={() => {
                    animate(velocityFactor, 1)
                }}
                totalListSize={totalListSize}
                state={state}
                overflow={overflow}
                loop={loop}
                as={as}
                fade={fade}
                sign={sign}
                fadeTransition={fadeTransition}
                pageTransition={pageTransition}
            />
        </TickerContext.Provider>
    )
}

export const Ticker = /** @__PURE__ */ forwardRef(TickerComponent) as <
    TagName extends keyof HTMLElements = "div"
>(
    props: TickerProps<TagName> &
        React.PropsWithChildren &
        React.RefAttributes<HTMLElement> &
        Record<string, any>
) => React.ReactElement | null

function ListView<TagName extends keyof HTMLElements>({
    children,
    containerProps,
    containerRef,
    listRef,
    gap,
    axis,
    alignItems,
    isMeasured,
    isInView,
    isStatic,
    items,
    offset,
    clonedItems,
    clampOffset,
    renderedOffset,
    onPointerEnter,
    onPointerLeave,
    totalListSize,
    itemSize,
    overflow,
    state,
    safeMargin,
    snap,
    loop,
    as,
    fade,
    sign,
    fadeTransition = defaultFadeTransition,
    pageTransition,
}: {
    children?: React.ReactNode
    containerProps: any
    containerRef: React.RefCallback<HTMLElement>
    listRef?: React.RefObject<HTMLUListElement | null>
    gap: number
    axis: "x" | "y"
    alignItems: "flex-start" | "center" | "flex-end" | "stretch"
    offset: MotionValue<number>
    renderedOffset: MotionValue<number>
    isMeasured?: boolean
    isInView?: boolean
    isStatic?: boolean
    onPointerEnter?: () => void
    onPointerLeave?: () => void
    items: React.ReactNode[]
    clonedItems?: React.ReactNode[]
    clampOffset?: (offset: number) => number
    totalListSize?: number
    itemSize: ItemSize
    overflow: boolean
    state: TickerState
    snap?: "page" | "loose" | false
    loop?: boolean
    safeMargin: number
    as: TagName
    fade: number | `${number}%`
    sign: 1 | -1
    fadeTransition?: Transition
    pageTransition?: Transition
}) {
    const MotionComponent = useMemo(() => motion.create(as), [as]) as any

    /**
     * Derive drag constraints based on measurements.
     */
    let dragConstraints: Record<string, number> = {}
    const { maxInset } = state
    if (maxInset !== null) {
        if (axis === "x") {
            dragConstraints =
                sign > 0
                    ? { left: maxInset * -1, right: 0 }
                    : { right: maxInset, left: 0 }
        } else {
            dragConstraints = { top: maxInset * -1, bottom: 0 }
        }
    }

    let {
        drag,
        _dragX,
        _dragY,
        dragMomentum = false,
        onDragEnd,
        onPointerDown,
        ...remainingProps
    } = containerProps
    const dragMotionValue = axis === "x" ? _dragX : _dragY

    const dragMomentumAnimation = useRef<ReturnType<typeof animate> | null>(
        null
    )

    /**
     * TODO: This should probably be accomplished with dragMotionValue.jump()
     * in the onPointerDown handler but investigate why this isn't working.
     */
    const stopDragMomentumAnimation = () => {
        if (!dragMomentumAnimation.current) return
        dragMomentumAnimation.current.stop()
        dragMomentumAnimation.current = null
    }

    if (!onDragEnd && drag && dragMotionValue) {
        onPointerDown = () => {
            dragMotionValue.jump(offset.get())
            stopDragMomentumAnimation()
        }

        onDragEnd = (_e: PointerEvent, { velocity }: PanInfo) => {
            const current = offset.get()
            stopDragMomentumAnimation()

            frame.postRender(() => {
                let target = current + velocity[axis] * (snap ? 0.3 : 0.8)

                if (snap) {
                    if (velocity[axis] < 0) {
                        target = -findNextItemInset(
                            -current,
                            state.itemPositions,
                            gap,
                            -target
                        )
                    } else if (velocity[axis] > 0) {
                        target = -findPrevItemInset(
                            -current,
                            state.itemPositions,
                            gap,
                            -target,
                            state.containerLength
                        )
                    } else {
                        const closestNext = -findNextItemInset(
                            -current,
                            state.itemPositions,
                            gap,
                            -current
                        )
                        const closestPrev = -findPrevItemInset(
                            -current,
                            state.itemPositions,
                            gap,
                            -current,
                            state.containerLength
                        )

                        target =
                            Math.abs(current - closestNext) <
                            Math.abs(current - closestPrev)
                                ? closestNext
                                : closestPrev
                    }
                }

                const constraints = loop
                    ? {}
                    : sign > 0
                    ? {
                          max: 0,
                          min: dragConstraints[axis === "x" ? "left" : "top"],
                      }
                    : {
                          min: 0,
                          max: dragConstraints.right,
                      }

                dragMomentumAnimation.current = animate(
                    dragMotionValue,
                    clampOffset!(target * sign) * sign,
                    snap
                        ? pageTransition
                        : {
                              type: "inertia",
                              velocity: velocity[axis],
                              modifyTarget: () => target,
                              bounceDamping: 40,
                              bounceStiffness: 400,
                              ...constraints,
                          }
                )
            })
        }
    }

    /**
     * Create mask image to fade edges out
     */
    const fadeStartOpacity = useMotionValue(loop ? 0 : 1)
    const fadeEndOpacity = useMotionValue(0)
    const strategy = getLayoutStrategy(axis, state.direction)
    const unit = typeof fade === "number" ? "px" : ""
    const maskImage = useTransform(() => {
        return `linear-gradient(to ${
            strategy.direction
        }, rgba(0,0,0,${fadeStartOpacity.get()}) 0px, black ${fade}${unit}, black calc(100% - ${fade}${unit}), rgba(0,0,0,${fadeEndOpacity.get()}) 100%)`
    })
    const fadeStyles = fade ? { maskImage, WebkitMaskImage: maskImage } : {}
    const isAtLimits = useRef({ start: true, end: false })
    useMotionValueEvent(renderedOffset, "change", (value) => {
        if (maxInset === null) return
        const maxOffset = maxInset * -1
        value *= sign

        // Start edge
        if (value < 0) {
            // If it's currently at the limits, and moves, fade mask out
            if (isAtLimits.current.start) {
                animate(fadeStartOpacity, 0, fadeTransition)
                isAtLimits.current.start = false
            }
        } else {
            if (!isAtLimits.current.start) {
                animate(fadeStartOpacity, 1, fadeTransition)
                isAtLimits.current.start = true
            }
        }

        // End edge
        if (value > maxOffset) {
            // If it's currently at the limits, and moves, fade mask out
            if (isAtLimits.current.end) {
                animate(fadeEndOpacity, 0, fadeTransition)
                isAtLimits.current.end = false
            }
        } else {
            if (!isAtLimits.current.end) {
                animate(fadeEndOpacity, 1, fadeTransition)
                isAtLimits.current.end = true
            }
        }
    })

    return (
        <>
            <MotionComponent
                {...remainingProps}
                ref={containerRef}
                style={{
                    overflowX: !overflow && axis === "x" ? "clip" : undefined,
                    overflowY: !overflow && axis === "y" ? "clip" : undefined,
                    ...containerStyle,
                    ...containerProps.style,
                    ...fadeStyles,
                }}
                onPointerEnter={onPointerEnter}
                onPointerLeave={onPointerLeave}
                drag={drag}
                _dragX={_dragX}
                _dragY={_dragY}
                dragConstraints={dragConstraints}
                dragMomentum={dragMomentum}
                onPointerDown={onPointerDown}
                onDragEnd={onDragEnd}
            >
                <motion.ul
                    ref={listRef}
                    style={{
                        ...listStyle,
                        flexDirection: axis === "x" ? "row" : "column",
                        gap: `${gap}px`,
                        x: axis === "x" ? renderedOffset : 0,
                        y: axis === "y" ? renderedOffset : 0,
                        opacity: isMeasured || isStatic ? 1 : 0,
                        alignItems,
                        willChange:
                            isMeasured && isInView ? "transform" : undefined,
                        width: "100%",
                        height: "100%",
                        maxHeight: "100%",
                        maxWidth: "100%",
                    }}
                >
                    {items.map((item, index) => (
                        <TickerItemWrapper
                            key={"original-" + index}
                            axis={axis}
                            offset={renderedOffset}
                            listSize={totalListSize}
                            itemIndex={index}
                            bounds={state.itemPositions[index] ?? defaultBounds}
                            alignItems={alignItems}
                            size={itemSize}
                            reproject={loop}
                            safeMargin={safeMargin}
                            numItems={items.length}
                        >
                            {item}
                        </TickerItemWrapper>
                    ))}
                    {clonedItems || null}
                </motion.ul>
            </MotionComponent>{" "}
            {children}
        </>
    )
}

const defaultBounds = { start: 0, end: 0 }

const containerStyle: React.CSSProperties = {
    display: "flex",
    position: "relative",
}

const listStyle: React.CSSProperties = {
    display: "flex",
    position: "relative",
    willChange: "transform",
    listStyleType: "none",
    padding: 0,
    margin: 0,
    justifyContent: "flex-start",
}

const defaultFadeTransition: Transition = {
    duration: 0.2,
    ease: "linear",
}
