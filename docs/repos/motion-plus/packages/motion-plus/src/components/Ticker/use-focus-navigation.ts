import { frame, isHTMLElement, MotionValue, wrap } from "motion/react"
import { useEffect, useRef } from "react"

export function useFocusNavigation(
    containerRef: React.RefObject<HTMLElement | null>,
    axis: "x" | "y",
    focusOffset: MotionValue<number>,
    offset: MotionValue<number>,
    setHasFocus: (hasFocus: boolean) => void
) {
    const isFocusTrapped = useRef(false)

    useEffect(() => {
        const container = containerRef.current

        if (!container) return

        let detectionEnabled = false

        const abortController = new AbortController()
        const eventOptions: EventListenerOptions = {
            signal: abortController.signal,
        } as any
        const eventOptionsWithCapture = {
            ...eventOptions,
            capture: true,
        }

        const scrollProp = axis === "x" ? "scrollLeft" : "scrollTop"
        const offsetProp = axis === "x" ? "offsetLeft" : "offsetTop"
        const leftKey = axis === "x" ? "ArrowLeft" : "ArrowUp"
        const rightKey = axis === "x" ? "ArrowRight" : "ArrowDown"

        let focusableElements: HTMLElement[] = []
        let focusIndex = 0

        const applyFocusOffset = () => {
            const nextFocusableElement = focusableElements[focusIndex]

            if (!nextFocusableElement) return

            nextFocusableElement.focus({ preventScroll: true })

            // Move the ticker offset to the focused item
            focusOffset.set(-nextFocusableElement[offsetProp])

            // Override the default browser scroll into view behaviour
            container[scrollProp] = 0
            frame.render(() => {
                container[scrollProp] = 0
            })
        }

        const handleFocusNavigation = (event: KeyboardEvent) => {
            if (event.key === "Tab") {
                event.preventDefault()

                // Focus the next selectable element in the DOM outside the container
                endFocusTrap()

                // Find the next focusable element after the container
                const allFocusableElements = Array.from(
                    document.querySelectorAll(
                        'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
                    )
                ).filter(isHTMLElement)

                // Sort the focusable elements by their tabIndex
                allFocusableElements.sort(compareTabIndexes)

                const lastFocusableElement =
                    allFocusableElements[
                        event.shiftKey ? 0 : allFocusableElements.length - 1
                    ]

                const initialIndex = event.shiftKey
                    ? allFocusableElements.length - 1
                    : 0

                /**
                 * If the last focusable element in the DOM is inside the container
                 * then we want to set focus on the first DOM element
                 */
                if (container.contains(lastFocusableElement)) {
                    allFocusableElements[initialIndex].focus()
                    return
                } else {
                    const indexOfCurrentElement = allFocusableElements.indexOf(
                        focusableElements[focusIndex]
                    )

                    const delta = event.shiftKey ? -1 : 1

                    for (
                        let i = indexOfCurrentElement;
                        i < allFocusableElements.length && i >= 0;
                        i += delta
                    ) {
                        const element = allFocusableElements[i]

                        if (!container.contains(element)) {
                            element.focus()
                            return
                        }
                    }
                }
                return
            } else if (event.key === leftKey) {
                focusIndex--
            } else if (event.key === rightKey) {
                focusIndex++
            }

            focusIndex = wrap(0, focusableElements.length, focusIndex)

            applyFocusOffset()
        }

        const startFocusTrap = () => {
            if (isFocusTrapped.current) return

            // Get all focusable elements within .ticker-item elements
            focusableElements = Array.from(
                container.querySelectorAll(
                    '.ticker-item a, .ticker-item button, .ticker-item input, .ticker-item textarea, .ticker-item select, .ticker-item [tabindex]:not([tabindex="-1"]), .ticker-item [contenteditable="true"]'
                )
            ).filter(isHTMLElement)

            focusIndex = 0

            if (!focusableElements.length) return

            setHasFocus(true)

            isFocusTrapped.current = true

            applyFocusOffset()

            window.addEventListener(
                "focus",
                detectTrapEnd,
                eventOptionsWithCapture
            )
            window.addEventListener(
                "blur",
                detectTrapEnd,
                eventOptionsWithCapture
            )
            container.addEventListener(
                "keydown",
                handleFocusNavigation,
                eventOptions
            )
        }

        const detectTrapEnd = (event: FocusEvent) => {
            if (
                !event.target ||
                !(event.target instanceof HTMLElement) ||
                !container.contains(event.target)
            ) {
                endFocusTrap()
            }
        }

        const endFocusTrap = () => {
            if (!isFocusTrapped.current) return

            isFocusTrapped.current = false

            setHasFocus(false)
            offset.set(focusOffset.get())

            window.removeEventListener("focus", detectTrapEnd)
            window.removeEventListener("blur", detectTrapEnd)
            container.removeEventListener("keydown", handleFocusNavigation)
        }

        const handleFocus = (event: FocusEvent) => {
            const { target } = event

            if (!isHTMLElement(target)) return

            if (!isFocusTrapped.current) {
                startFocusTrap()
            }
        }

        const detectFocusTrapEnable = () => {
            if (detectionEnabled) return

            detectionEnabled = true

            container.addEventListener(
                "focus",
                handleFocus,
                eventOptionsWithCapture
            )
            window.addEventListener(
                "pointermove",
                handlePointerMove,
                eventOptions
            )
        }

        const handlePointerMove = () => {
            if (!detectionEnabled) return

            detectionEnabled = false
            container.removeEventListener("focus", handleFocus, true)
            window.removeEventListener(
                "pointermove",
                handlePointerMove,
                eventOptions
            )
        }

        const handleAriaHiddenClicks = (event: PointerEvent) => {
            const target = event.target as HTMLElement

            // Check if target is a descendant of an element with aria-hidden="true"
            let ariaHiddenAncestor = target.closest('[aria-hidden="true"]')
            if (ariaHiddenAncestor) {
                ariaHiddenAncestor.removeAttribute("aria-hidden")
            }
        }

        const resetScroll = () => {
            container.scrollLeft = 0
            container.scrollTop = 0
        }

        window.addEventListener("keydown", detectFocusTrapEnable, eventOptions)
        container.addEventListener(
            "pointerdown",
            handleAriaHiddenClicks,
            eventOptions
        )
        container.addEventListener("scroll", resetScroll, eventOptions)

        return () => {
            abortController.abort()
            endFocusTrap()
        }
    }, [])
}

function compareTabIndexes(a: HTMLElement, b: HTMLElement) {
    // Elements with tabIndex >= 1 come first, ordered by tabIndex value
    if (a.tabIndex >= 1 && b.tabIndex >= 1) {
        return a.tabIndex - b.tabIndex
    }

    // Elements with tabIndex >= 1 come before tabIndex 0 or -1
    if (a.tabIndex >= 1 && b.tabIndex <= 0) {
        return -1
    }

    if (b.tabIndex >= 1 && a.tabIndex <= 0) {
        return 1
    }

    // Both have tabIndex 0 or -1, maintain document order (return 0)
    // tabIndex -1 elements are focusable programmatically but not via tab navigation
    return 0
}
