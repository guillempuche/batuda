import {
    animate,
    AnimationOptions,
    HTMLMotionProps,
    motion,
    MotionConfigContext,
    useIsPresent,
} from "motion/react"
import {
    CSSProperties,
    forwardRef,
    useContext,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
} from "react"
import { useIsInitialRender } from "./hooks/use-is-initial-render"
import { maskHeight } from "./Mask"
import { getWidthInEm } from "./utils/get-width-in-ems"
import { targetWidths } from "./utils/target-widths"

function mod(n: number, m: number) {
    return ((n % m) + m) % m
}

export const NumberDigit = forwardRef<
    HTMLSpanElement,
    Omit<HTMLMotionProps<"span">, "children"> & {
        value: number
        initialValue?: number
        trend?: number
    }
>(function NumberDigit(
    { value: _value, initialValue: _initialValue = _value, trend = 0, ...rest },
    _ref
) {
    const { transition } = useContext(MotionConfigContext)
    const initialValue = useRef(_initialValue).current // non-reactive, like React's defaultValue props
    const isInitialRender = useIsInitialRender()

    const scope = useRef<HTMLSpanElement>(null)
    const ref = useRef<HTMLSpanElement>(null)
    useImperativeHandle(_ref, () => ref.current!, [])

    const numberRefs = useRef(new Array<HTMLSpanElement | null>(10))

    // Don't use a normal exit animation for this because we want it to trigger a resize:
    const isPresent = useIsPresent()
    const value = isPresent ? _value : 0

    // Set the width to the width of the initial value immediately, so on the next render we animate from that:
    useLayoutEffect(() => {
        if (!scope.current || !numberRefs.current[initialValue]) return
        scope.current.style.width = getWidthInEm(
            numberRefs.current[initialValue]
        )
    }, [])

    // Animate the y in a layout effect, because it's a FLIP
    const prevValue = useRef(_initialValue)
    useLayoutEffect(() => {
        if (!scope.current || value === prevValue.current) return
        const box = scope.current.getBoundingClientRect()
        const refBox = ref.current?.getBoundingClientRect()

        // Compute the trend-aware delta for wrapping
        const oldVal = prevValue.current
        let delta = value - oldVal
        if (trend > 0 && value < oldVal) {
            // Force upward: wrap through 10
            delta = 10 - oldVal + value
        } else if (trend < 0 && value > oldVal) {
            // Force downward: wrap through 0
            delta = value - 10 - oldVal
        }

        // Using a number seems to ensure Motion ends with "none", which we want:
        // Add the offset between the top of the inner and outer elements to account for
        // any current animation state:
        const initialY =
            box.height * delta +
            (box.top - (refBox ? refBox.top || 0 : box.top))

        animate(
            scope.current,
            { y: [initialY, 0] },
            transition as AnimationOptions
        )

        return () => {
            prevValue.current = value
        }
    }, [value])

    // Animate width
    useEffect(() => {
        // Skip setting the width if this is the first render and it's not going to animate:
        if (isInitialRender && initialValue === value) return
        if (!numberRefs.current[value]) return
        const w = getWidthInEm(numberRefs.current[value])
        // Store the target width immediately, so it can be used for the section resize:
        if (ref.current) targetWidths.set(ref.current, w)
        // Animate to the new width:
        if (ref.current) {
            animate(
                ref.current,
                { width: w },
                transition as AnimationOptions
            )
        }
    }, [value])

    const renderNumber = (i: number) => (
        <span
            key={i}
            style={{
                display: "inline-block",
                padding: `calc(${maskHeight}/2) 0`,
            }}
            ref={(r) => void (numberRefs.current[i] = r)}
        >
            {i}
        </span>
    )

    // Render 9 digits above and 9 below the current value, wrapping mod 10.
    // This allows the FLIP animation to scroll in either direction through
    // the full digit cycle. The column is clipped by the parent overflow.
    const aboveDigits: number[] = []
    const belowDigits: number[] = []
    for (let offset = 9; offset >= 1; offset--) {
        aboveDigits.push(mod(value - offset, 10))
    }
    for (let offset = 1; offset <= 9; offset++) {
        belowDigits.push(mod(value + offset, 10))
    }

    return (
        <motion.span
            {...rest}
            ref={ref}
            data-state={isPresent ? undefined : "exiting"}
            style={{
                display: "inline-flex",
                justifyContent: "center",
            }}
        >
            <span
                ref={scope}
                style={{
                    display: "inline-flex",
                    justifyContent: "center",
                    flexDirection: "column",
                    alignItems: "center",
                    position: "relative",
                }}
            >
                {aboveDigits.length > 0 && (
                    <span
                        style={{
                            ...digitFillStyle,
                            bottom: `100%`,
                            left: 0,
                        }}
                    >
                        {aboveDigits.map((d) => renderNumber(d))}
                    </span>
                )}
                {renderNumber(value)}
                {belowDigits.length > 0 && (
                    <span
                        style={{
                            ...digitFillStyle,
                            top: `100%`,
                            left: 0,
                        }}
                    >
                        {belowDigits.map((d) => renderNumber(d))}
                    </span>
                )}
            </span>
        </motion.span>
    )
})

const digitFillStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    position: "absolute",
    width: "100%",
}
