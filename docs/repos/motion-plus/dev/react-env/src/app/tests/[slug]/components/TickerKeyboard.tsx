"use client"

import { Ticker } from "motion-plus/react"
import { motion, useMotionValue } from "motion/react"

/**
 * Title: Ticker: Keyboard navigation
 */

function Item({ index }: { index: number }) {
    return (
        <div
            style={{
                width: "100px",
                height: "140px",
                backgroundColor: `hsl(${index * 30}, 100%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
            }}
        >
            <a href="#" data-linkid={`link-${index}-a`}>
                Link
            </a>
            <a href="#" data-linkid={`link-${index}-b`}>
                Link
            </a>
        </div>
    )
}

export default function Example() {
    const offset = useMotionValue(-100)
    const isPaused =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("pause")

    return (
        <>
            <motion.button whileFocus={{ backgroundColor: "red" }} id="a">
                Focus first
            </motion.button>
            <div
                style={{
                    display: "flex",
                    gap: "10px",
                    flexDirection: "column",
                }}
            >
                {/* Example of keyboard navigation */}
                <Ticker
                    offset={isPaused ? offset : undefined}
                    id="ticker"
                    items={[
                        <Item key={0} index={0} />,
                        <Item key={1} index={1} />,
                    ]}
                    style={{ width: 400 }}
                />
            </div>
            <motion.button whileFocus={{ backgroundColor: "red" }} id="b">
                Focus last
            </motion.button>
        </>
    )
}
