"use client"

import { scrambleText, ScrambleTextControls } from "motion-plus-dom"
import {
    motion,
    useIsomorphicLayoutEffect,
    useMotionValue,
} from "motion/react"
import { ElementType, forwardRef, useRef } from "react"
import { ScrambleTextProps } from "./types"

// Get motion component for a given element type
type MotionComponents = typeof motion
function getMotionComponent(as: ElementType | undefined): MotionComponents[keyof MotionComponents] {
    const tag = (as || "span") as keyof MotionComponents
    return motion[tag] || motion.span
}

export const ScrambleText = forwardRef(function ScrambleText<
    T extends ElementType = "span"
>(
    {
        children: text = "",
        as,
        active = true,
        delay,
        duration,
        interval,
        chars,
        onComplete,
        ...props
    }: ScrambleTextProps<T>,
    ref: React.ForwardedRef<HTMLElement>
) {
    const MotionComponent = getMotionComponent(as) as ElementType
    const displayText = useMotionValue(text)
    const controlsRef = useRef<ScrambleTextControls | null>(null)
    const onCompleteRef = useRef(onComplete)

    // Keep onComplete ref up to date without triggering effect
    useIsomorphicLayoutEffect(() => {
        onCompleteRef.current = onComplete
    })

    // Effect 1: Reset MotionValue when text prop changes
    useIsomorphicLayoutEffect(() => {
        displayText.set(text)
    }, [text])

    // Effect 2: Create scrambleText instance
    useIsomorphicLayoutEffect(() => {
        controlsRef.current?.stop()

        controlsRef.current = scrambleText(displayText, {
            delay,
            duration,
            interval,
            chars,
            onComplete: () => onCompleteRef.current?.(),
        })

        if (!active) {
            controlsRef.current.finish()
        }

        return () => controlsRef.current?.stop()
    }, [active, text, delay, duration, interval, chars])

    return (
        <MotionComponent ref={ref} {...props}>
            {displayText}
        </MotionComponent>
    )
}) as <T extends ElementType = "span">(
    props: ScrambleTextProps<T> & React.RefAttributes<HTMLElement>
) => React.ReactElement | null
