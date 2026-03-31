"use client"

import { getNextText, getTypewriterDelay } from "motion-plus-dom"
import {
    animate,
    AnimationPlaybackControls,
    delay,
    motion,
    useMotionValue,
} from "motion/react"
import { ElementType, forwardRef, useEffect, useRef } from "react"
import { TypewriterProps, TYPING_SPEEDS } from "./types"

export const Typewriter = forwardRef(function Typewriter<
    T extends ElementType = "span"
>(
    {
        children: text = "",
        as,
        speed = "normal",
        variance = "natural",
        cursorClassName = "motion-typewriter-cursor",
        cursorStyle,
        cursorBlinkDuration = 0.5,
        cursorBlinkRepeat = Infinity,
        onComplete,
        onChange,
        play = true,
        "aria-label": ariaLabel,
        textClassName,
        textStyle,
        replace = "type",
        backspace = "character",
        backspaceFactor = 0.2,
        ...props
    }: TypewriterProps<T>,
    ref: React.ForwardedRef<HTMLElement>
) {
    const Component = (as || "span") as ElementType
    const targetText = useRef(text)
    const displayText = useMotionValue("")
    const cancelDelay = useRef<VoidFunction | null>(null)
    const cursorBlinkAnimation = useRef<AnimationPlaybackControls | null>(null)
    const cursorRef = useRef<HTMLSpanElement>(null)

    const interval = typeof speed === "number" ? speed : TYPING_SPEEDS[speed]

    const clearDelay = () => {
        cancelDelay.current?.()
        cancelDelay.current = null
    }

    const startCursorBlinkAnimation = () => {
        cursorBlinkAnimation.current = animate(
            cursorRef.current!,
            {
                opacity: [1, 1, 0, 0],
            },
            {
                duration: cursorBlinkDuration,
                times: [0, 0.5, 0.5, 1],
                ease: "linear",
                repeat: Math.max(0, cursorBlinkRepeat) * 2,
                repeatType: "reverse",
            }
        );
        cursorBlinkAnimation.current.finished.then(() => {
            cursorBlinkAnimation.current?.cancel()
        })
    }

    useEffect(() => {
        /**
         * If we're using replace: "all" and the text changes, we can instantly
         * reset the displayed text.
         */
        if (replace === "all" && text !== targetText.current) {
            // Reset and start over
            displayText.set("")
        }

        targetText.current = text
    }, [text, replace])

    useEffect(() => {
        if (!play) {
            startCursorBlinkAnimation()
            clearDelay()
            return
        }

        cursorBlinkAnimation.current?.cancel()

        const nextCharacter = () => {
            const previousText = displayText.get()
            const nextText = getNextText(
                previousText,
                text,
                replace,
                backspace
            )

            displayText.set(nextText)

            if (onChange) {
                const isBackspace = nextText.length < previousText.length
                const character = isBackspace
                    ? previousText.slice(nextText.length)
                    : nextText.slice(previousText.length)
                onChange({ text: nextText, character, isBackspace })
            }

            if (nextText !== text) {
                scheduleNextCharacter()
            } else {
                startCursorBlinkAnimation()
                onComplete?.()
            }
        }

        const scheduleNextCharacter = () => {
            cancelDelay.current = delay(
                nextCharacter,
                getTypewriterDelay(
                    text,
                    displayText.get(),
                    interval,
                    variance,
                    backspaceFactor
                )
            )
        }

        if (!cancelDelay.current) {
            scheduleNextCharacter()
        }

        return clearDelay
    }, [play, onComplete, onChange, text, interval, variance, backspaceFactor, backspace])

    return (
        <Component ref={ref} {...props} aria-label={ariaLabel || text}>
            <motion.span className={textClassName} style={textStyle}>
                {displayText}
            </motion.span>
            <motion.span
                ref={cursorRef}
                className={cursorClassName}
                style={{
                    display: "inline-block",
                    width: "2px",
                    height: "1em",
                    backgroundColor: "currentColor",
                    position: "relative",
                    top: "0.1em",
                    left: "0.2em",
                    ...cursorStyle,
                }}
            />
        </Component>
    )
}) as <T extends ElementType = "span">(
    props: TypewriterProps<T> & React.RefAttributes<HTMLElement>
) => React.ReactElement | null
