"use client"

import {
    easeOut,
    motion,
    MotionConfig,
    MotionConfigContext,
    type HTMLMotionProps,
    type MotionConfigProps,
} from "motion/react"
import { ComponentProps, forwardRef, useContext, useMemo, useRef } from "react"
import { Mask, maskHeight } from "./Mask"
import { NumberSection } from "./NumberSection"
import { Trend } from "./types"
import { formatToParts } from "./utils/format-parts"

export const DEFAULT_TRANSITION = {
    opacity: { duration: 1, ease: easeOut }, // perceptual duration of 0.5s
    y: { type: "spring", duration: 1, bounce: 0 },
    width: { type: "spring", duration: 1, bounce: 0 },
} as const satisfies MotionConfigProps["transition"]

export type AnimateNumberProps = Omit<HTMLMotionProps<"span">, "children"> & {
    /** The number to display. Accepts `number`, `bigint`, or numeric `string`. */
    children: number | bigint | string
    /** Locale(s) for `Intl.NumberFormat`. e.g. `"en-US"`, `["de-DE", "en-US"]`. */
    locales?: Intl.LocalesArgument
    /**
     * Options passed to `Intl.NumberFormat`.
     * Scientific and engineering notation are not supported.
     */
    format?: Omit<Intl.NumberFormatOptions, "notation"> & {
        notation?: Exclude<
            Intl.NumberFormatOptions["notation"],
            "scientific" | "engineering"
        >
    }
    /** Override the animation transition. Applies to `y` (digit spin), `width` (resize), and `opacity` (enter/exit). */
    transition?: ComponentProps<typeof MotionConfig>["transition"]
    /** Static text appended after the number (e.g. `"/mo"`). */
    suffix?: string
    /** Static text prepended before the number (e.g. `"~"`). */
    prefix?: string
    /**
     * Controls the spin direction of digit animations.
     *
     * - `1` — always spin upward (9 wraps to 0)
     * - `-1` — always spin downward (0 wraps to 9)
     * - `0` / `undefined` — auto-detect based on value change
     * - `(oldValue, newValue) => number` — custom function
     *
     * @example
     * // Always spin up, even when the value decreases
     * <AnimateNumber trend={1}>{value}</AnimateNumber>
     *
     * @example
     * // Custom: spin up for positive changes, down for negative
     * <AnimateNumber trend={(old, val) => Math.sign(val - old)}>
     *   {value}
     * </AnimateNumber>
     */
    trend?: Trend
}

export const AnimateNumber = forwardRef<HTMLDivElement, AnimateNumberProps>(
    function AnimateNumber(
        {
            children: value,
            locales,
            format,
            transition,
            style,
            suffix,
            prefix,
            trend,
            ...rest
        },
        ref
    ) {
        // Split the number into parts
        const parts = useMemo(
            () => formatToParts(value, { locales, format }, prefix, suffix),
            [value, locales, format]
        )
        const { pre, integer, fraction, post, formatted } = parts

        const contextTransition = useContext(MotionConfigContext).transition
        transition = transition ?? contextTransition ?? DEFAULT_TRANSITION

        // Track previous value for trend computation
        const numericValue =
            typeof value === "string" ? parseFloat(value) : Number(value)
        const prevValueRef = useRef(numericValue)
        const prevValue = prevValueRef.current
        prevValueRef.current = numericValue

        // Resolve trend direction
        let resolvedTrend: number
        if (typeof trend === "function") {
            resolvedTrend = trend(prevValue, numericValue)
        } else if (trend !== undefined) {
            resolvedTrend = trend
        } else {
            resolvedTrend = Math.sign(numericValue - prevValue)
        }

        return (
            <MotionConfig transition={transition}>
                <motion.span
                    {...rest}
                    ref={ref}
                    style={{
                        lineHeight: 1, // make this one easy to override
                        ...style,
                        display: "inline-flex",
                        isolation: "isolate", // so number can be underneath first/last
                        whiteSpace: "nowrap",
                    }}
                >
                    <span
                        aria-label={formatted}
                        style={{
                            display: "inline-flex",
                            direction: "ltr", // I think this is needed b/c numbers are always LTR?
                            isolation: "isolate", // so number can be underneath pre/post
                            position: "relative",
                            zIndex: -1, // so the whole number is under any first/last
                        }}
                    >
                        <NumberSection
                            style={{ padding: `calc(${maskHeight}/2) 0` }}
                            aria-hidden={true}
                            justify="right"
                            mode="popLayout"
                            parts={pre}
                            name="pre"
                            trend={resolvedTrend}
                        />
                        <Mask>
                            <NumberSection
                                justify="right"
                                parts={integer}
                                name="integer"
                                trend={resolvedTrend}
                            />
                            <NumberSection
                                parts={fraction}
                                name="fraction"
                                trend={resolvedTrend}
                            />
                        </Mask>
                        <NumberSection
                            style={{ padding: `calc(${maskHeight}/2) 0` }}
                            aria-hidden={true}
                            mode="popLayout"
                            parts={post}
                            name="post"
                            trend={resolvedTrend}
                        />
                    </span>
                </motion.span>
            </MotionConfig>
        )
    }
)
