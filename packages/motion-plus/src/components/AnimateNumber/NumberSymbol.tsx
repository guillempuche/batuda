import {
    AnimatePresence,
    HTMLMotionProps,
    motion,
    useIsPresent,
} from "motion/react"
import { forwardRef, useContext } from "react"
import { maskHeight } from "./Mask"
import { SectionContext } from "./SectionContext"

export interface NumberSymbolProps extends HTMLMotionProps<"span"> {
    partKey: string
    type: string
    children: string
}

export const NumberSymbol = forwardRef(function NumberSymbol(
    { partKey, type, children, ...rest }: NumberSymbolProps,
    ref: React.Ref<HTMLSpanElement>
) {
    const isPresent = useIsPresent()
    const { justify } = useContext(SectionContext)

    return (
        <motion.span
            {...rest}
            data-state={isPresent ? undefined : "exiting"}
            style={{
                display: "inline-flex",
                justifyContent: justify,
                padding: `calc(${maskHeight}/2) 0`, // match digits
                position: "relative", // needed for AnimatePresent popLayout
            }}
            ref={ref}
        >
            <AnimatePresence mode="popLayout" anchorX={justify} initial={false}>
                <motion.span
                    key={children} // re-create on value change
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [null, 1] }}
                    exit={{ opacity: [null, 0] }}
                    style={{
                        display: "inline-block",
                        whiteSpace: "pre", // some symbols are spaces or thin spaces
                    }}
                >
                    {children}
                </motion.span>
            </AnimatePresence>
        </motion.span>
    )
})
