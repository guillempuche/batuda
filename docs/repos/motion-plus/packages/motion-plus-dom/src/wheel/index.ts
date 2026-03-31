type WheelState = "IDLE" | "WHEELING" | "SWIPING"
type Direction = 1 | -1

interface WheelGestureOptions {
    /**
     * The axis to listen for wheel events on.
     * @default "x"
     */
    axis?: "x" | "y"

    /**
     * Callback for direct wheel manipulation.
     * Fired when the gesture is not interpreted as a swipe.
     * The delta is the raw wheel delta on the specified axis.
     */
    onWheel?: (delta: number) => void

    /**
     * Callback for paginated swipe gestures.
     * Fired when the accumulated delta exceeds `swipeThreshold`.
     */
    onSwipe?: (direction: Direction) => void

    /**
     * The amount of accumulated delta required to trigger a swipe.
     * @default 100
     */
    swipeThreshold?: number

    /**
     * The time in ms after the last wheel event to consider the gesture "session" finished.
     * This is key to differentiating discrete swipes.
     * @default 150
     */
    swipeTimeout?: number

    /**
     * The amount of wheel delta required to be recognised as a new
     * swipe gesture session.
     * @default 10
     */
    jitterThreshold?: number

    lineHeight?: number
}

function calcDirection(delta: number) {
    return -Math.sign(delta) as Direction
}

export function wheel(
    element: Element,
    {
        axis = "y",
        onWheel,
        onSwipe,
        swipeThreshold = 100,
        swipeTimeout = 150,
        jitterThreshold = 2,
        lineHeight = 16,
    }: WheelGestureOptions
) {
    let state: WheelState = "IDLE"

    /**
     * The accumulated delta value. Once this becomes greater than
     * swipeThreshold, a swipe is triggered. It gets reset to 0 either when
     * swipe is interrupted, or after a timeout from wheel events.
     */
    let accumulator = 0

    /**
     * The direction of the swipe.
     * 1 = forward, -1 = backward, 0 = no swipe.
     */
    let swipeDirection: Direction | 0 = 0

    /**
     * The last delta value. Used to detect momentum scrolls and decide
     * when a new wheel sessions has started via touchpad.
     */
    let lastDelta = 0

    /**
     * True when the wheel delta is decelerating. If this is true, then further
     * wheel acceleration will be considered a new gesture and wheel events
     * will start firing.
     */
    let isDecelerating = false
    let accelerationCount = 0

    /**
     * Whether the gesture has swiped in the wheel session. This caps the number
     * of swipes per session to 1.
     */
    let hasSwipedInSession = false

    /**
     * The timeout ID for the session.
     */
    let sessionTimeoutId: NodeJS.Timeout | null = null

    const wheelHandler = (event: WheelEvent) => {
        const primaryDelta =
            axis === "x" && !event.shiftKey ? event.deltaX : event.deltaY
        const perpendicularDelta =
            axis === "x" && !event.shiftKey ? event.deltaY : event.deltaX

        // Only fire if the magnitude in the specified axis is greater than or equal to the perpendicular axis
        if (Math.abs(primaryDelta) < Math.abs(perpendicularDelta)) {
            return
        }

        if (onWheel || onSwipe) event.preventDefault()

        let delta = -(event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? primaryDelta * lineHeight
            : primaryDelta)

        if (delta === 0) return

        if (sessionTimeoutId) clearTimeout(sessionTimeoutId)
        sessionTimeoutId = setTimeout(() => {
            state = "IDLE"
            hasSwipedInSession = false
            accumulator = 0
        }, swipeTimeout)

        if (state === "IDLE") state = "WHEELING"

        const newDirection = calcDirection(delta)

        function startSwipe(
            triggeringDelta: number,
            currentAccumulator: number
        ) {
            state = "SWIPING"
            hasSwipedInSession = true
            swipeDirection = calcDirection(currentAccumulator)

            // Reset momentum detection state for the new swipe
            isDecelerating = false
            accelerationCount = 0
            lastDelta = Math.abs(triggeringDelta)

            onSwipe?.(swipeDirection)

            // Set the accumulator to the remainder of the swipe delta
            accumulator =
                (Math.abs(currentAccumulator) % swipeThreshold) * swipeDirection
        }

        switch (state) {
            case "WHEELING": {
                const newAccumulator = accumulator + delta

                if (
                    onSwipe &&
                    !hasSwipedInSession &&
                    Math.abs(newAccumulator) >= swipeThreshold
                ) {
                    startSwipe(delta, newAccumulator)
                } else {
                    accumulator = newAccumulator
                    onWheel?.(delta)
                }
                break
            }
            case "SWIPING": {
                const deltaAbs = Math.abs(delta)

                // Determine if a new gesture has started, either by direction change or momentum change.
                const isDirectionChange = newDirection !== swipeDirection
                let isMomentumChange = false

                if (lastDelta > 0) {
                    const deltaDiff = deltaAbs - lastDelta

                    if (deltaDiff < 0) isDecelerating = true

                    if (isDecelerating && deltaDiff > jitterThreshold) {
                        accelerationCount++
                        if (accelerationCount > 2) isMomentumChange = true
                    } else {
                        accelerationCount = 0
                    }
                }

                if (isDirectionChange || isMomentumChange) {
                    // A new gesture has been detected. Reset the session lock.
                    hasSwipedInSession = false

                    // Treat this event as the start of a new wheeling action.
                    const newAccumulator = delta

                    if (
                        onSwipe &&
                        !hasSwipedInSession &&
                        Math.abs(newAccumulator) >= swipeThreshold
                    ) {
                        startSwipe(delta, newAccumulator)
                    } else {
                        // Otherwise, transition to wheeling with this new delta.
                        state = "WHEELING"
                        accumulator = newAccumulator
                        onWheel?.(delta)
                    }
                    break
                }

                // If no interrupt, just update lastDelta for the next event.
                lastDelta = deltaAbs
                break
            }
        }
    }

    element.addEventListener("wheel", wheelHandler as EventListener, {
        passive: false,
    })

    return () => {
        if (sessionTimeoutId) clearTimeout(sessionTimeoutId)
        element.removeEventListener("wheel", wheelHandler as EventListener)
    }
}
