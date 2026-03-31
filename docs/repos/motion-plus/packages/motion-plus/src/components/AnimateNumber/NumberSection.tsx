"use client"

import {
    animate,
    AnimatePresence,
    AnimationOptions,
    MotionConfigContext,
    type AnimatePresenceProps,
} from "motion/react"
import {
    CSSProperties,
    forwardRef,
    HTMLAttributes,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
} from "react"
import { useIsInitialRender } from "./hooks/use-is-initial-render"
import { NumberDigit } from "./NumberDigit"
import { NumberSymbol } from "./NumberSymbol"
import { SectionContext } from "./SectionContext"
import { Justify, KeyedNumberPart } from "./types"
import { getWidthInEm } from "./utils/get-width-in-ems"
import { targetWidths } from "./utils/target-widths"

export const NumberSection = forwardRef<
    HTMLSpanElement,
    Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
        parts: KeyedNumberPart[]
        justify?: Justify
        mode?: AnimatePresenceProps["mode"]
        name?: string
        trend?: number
    }
>(function NumberSection(
    { parts, justify = "left", mode, style, name, trend, ...rest },
    _ref
) {
    const ref = useRef<HTMLSpanElement>(null)
    useImperativeHandle(_ref, () => ref.current!, [])

    const context = useMemo(() => ({ justify }), [justify])

    const measuredRef = useRef<HTMLSpanElement>(null)
    const isInitialRender = useIsInitialRender()
    const { transition } = useContext(MotionConfigContext)

    // Keep a fixed width for the section, so that new characters get added to the end before the
    // width animation starts, which makes them look like they were there already:
    useEffect(() => {
        if (!measuredRef.current || !ref.current) return
        if (isInitialRender) {
            ref.current.style.width = getWidthInEm(measuredRef.current)
            return
        }

        // Find the new width by removing exiting elements, measuring the measuredRef, and re-adding them
        // This better handles i.e. negative margins between elements.
        // We query the DOM because AnimatePresence overwrites ref props if the mode=popLayout

        const undos = Array.from(measuredRef.current.children).map((child) => {
            if (!(child instanceof HTMLElement)) return

            if (child.dataset.state === "exiting") {
                const next = child.nextSibling
                child.remove()
                return () => {
                    // insertBefore() appends if next is null:
                    if (measuredRef.current) {
                        measuredRef.current.insertBefore(child, next)
                    }
                }
            }

            const newWidth = targetWidths.get(child)
            if (!newWidth) return
            const oldWidth = child.style.width
            child.style.width = newWidth
            return () => {
                child.style.width = oldWidth
            }
        })
        // Measure the resulting width:
        const newWidth = getWidthInEm(measuredRef.current)
        // Then undo immediately:
        for (let i = undos.length - 1; i >= 0; i--) {
            const undo = undos[i]
            if (undo) undo()
        }
        // Animate to the new width:
        animate(
            ref.current,
            { width: newWidth },
            transition as AnimationOptions
        )
    }, [parts.map((p) => p.value).join("")])

    return (
        <SectionContext.Provider value={context}>
            <span
                {...rest}
                ref={ref}
                className={`number-section-${name}`}
                style={{
                    ...style,
                    display: "inline-flex",
                    justifyContent: justify,
                } as CSSProperties}
            >
                <span
                    ref={measuredRef}
                    style={{
                        display: "inline-flex",
                        justifyContent: "inherit",
                        position: "relative", // needed for AnimatePresent popLayout
                    }}
                >
                    {/* zero width space to prevent the height from collapsing when there's no children: */}
                    &#8203;
                    <AnimatePresence
                        mode={mode}
                        anchorX={justify}
                        initial={false}
                    >
                        {parts.map((part) =>
                            part.type === "integer" ||
                            part.type === "fraction" ? (
                                <NumberDigit
                                    key={part.key}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    value={part.value}
                                    initialValue={
                                        isInitialRender ? undefined : 0
                                    }
                                    trend={trend}
                                />
                            ) : (
                                <NumberSymbol
                                    key={
                                        part.type === "literal"
                                            ? `${part.key}:${part.value}`
                                            : part.key
                                    }
                                    type={part.type}
                                    partKey={part.key}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    {part.value}
                                </NumberSymbol>
                            )
                        )}
                    </AnimatePresence>
                </span>
            </span>
        </SectionContext.Provider>
    )
})
