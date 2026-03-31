"use client"

import { Ticker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Change size of children
 */

function Item({ index, width }: { index: number; width: number }) {
    return (
        <div
            style={{
                width,
                height: "140px",
                backgroundColor: `hsl(${index * 30}, 100%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
            }}
        />
    )
}

export default function Example() {
    const offset = useMotionValue(0)
    const [width, setWidth] = useState(100)

    const shiftOffset = () => {
        offset.set(offset.get() - 100)
    }

    const shiftWidth = () => {
        setWidth(200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            {/* Example of one item */}
            <Ticker
                id="one-item"
                items={[<Item width={width} key={0} index={0} />]}
                style={{ width: 530 }}
                offset={offset}
            />

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                }}
            >
                <button id="move" onClick={shiftOffset}>
                    Move
                </button>
                <button id="size" onClick={shiftWidth}>
                    Resize
                </button>
            </div>
        </div>
    )
}
