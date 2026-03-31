"use client"

import { motion } from "framer-motion"
import { Cursor } from "motion-plus/react"
import { useRef } from "react"

/**
 * Title: Cursor: Magnetic
 */

export default function Example() {
    const buttonRef = useRef<HTMLButtonElement>(null)
    const button2Ref = useRef<HTMLButtonElement>(null)

    return (
        <div style={container}>
            <motion.button
                ref={buttonRef}
                data-testid="pointer-target"
                style={{
                    background: "red",
                    padding: 8,
                    width: 200,
                    height: 50,
                    color: "var(--hue-4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
                whileTap={{ scale: 0.95 }}
            >
                <motion.span
                    style={{
                        pointerEvents: "none",
                        width: 20,
                        height: 20,
                        background: "white",
                    }}
                />
            </motion.button>
            <motion.button
                ref={button2Ref}
                data-testid="pointer-target-2"
                style={{
                    background: "blue",
                    width: 200,
                    height: 50,
                    color: "var(--hue-4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    top: 50,
                }}
            >
                <motion.span
                    style={{
                        pointerEvents: "none",
                        width: 20,
                        height: 20,
                        background: "white",
                    }}
                />
            </motion.button>
            <Cursor
                data-testid="cursor"
                magnetic
                variants={{
                    default: { borderRadius: 20, opacity: 0.9 },
                    pointer: { borderRadius: 5 },
                    pressed: {
                        scale: 0.95,
                        opacity: 1,
                        backgroundColor: "#444",
                    },
                }}
                style={{
                    backgroundColor: "#9999",
                }}
            />
            <Cursor
                data-testid="cursor-disable-morph"
                magnetic={{ morph: false }}
                variants={{
                    default: { borderRadius: 20, opacity: 0.9 },
                    pointer: { borderRadius: 5 },
                    pressed: {
                        scale: 0.95,
                        opacity: 1,
                        backgroundColor: "#444",
                    },
                }}
                style={{
                    backgroundColor: "#9999",
                }}
            />
            <Cursor
                data-testid="cursor-add-padding"
                magnetic={{ padding: 10 }}
                variants={{
                    default: { borderRadius: 20, opacity: 0.9 },
                    pointer: { borderRadius: 5 },
                    pressed: {
                        scale: 0.95,
                        opacity: 1,
                        backgroundColor: "#444",
                    },
                }}
                style={{
                    backgroundColor: "#9999",
                }}
            />
            <Cursor
                data-testid="cursor-no-padding"
                magnetic={{ padding: 0, snap: 0 }}
                style={{
                    backgroundColor: "#9999",
                }}
            />
        </div>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    width: 600,
    flexDirection: "column",
    padding: 100,
    height: 400,
    background: "#eee",
    position: "absolute",
    top: 100,
    left: 0,
}
