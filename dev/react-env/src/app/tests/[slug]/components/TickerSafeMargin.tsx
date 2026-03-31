"use client"

import { Ticker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Padding
 */

function Item({ index }: { index: number }) {
    return (
        <div
            style={{
                width: "100px",
                height: "100px",
                backgroundColor: `hsl(${index * 30}, 100%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
            }}
        />
    )
}

export default function Example() {
    const offset = useMotionValue(0)
    const [width, setWidth] = useState(520)

    const shiftOffset = () => {
        offset.set(offset.get() - 100)
    }

    const shiftWidth = () => {
        setWidth(width)
    }

    return (
        <div
            style={{
                display: "flex",
                gap: "10px",
                flexDirection: "column",
            }}
        >
            <style>
                {`
                    html, body {
                        overflow-x: hidden;
                    }
                `}
            </style>
            <Ticker
                id="x"
                items={[<Item key={0} index={0} />]}
                style={{ width, padding: 20 }}
                offset={offset}
                safeMargin={200}
            />
            <Ticker
                overflow
                id="x-overflow"
                items={[<Item key={0} index={0} />]}
                style={{ width, padding: 20 }}
                offset={offset}
                safeMargin={200}
            />
            <Ticker
                id="y"
                axis="y"
                items={[<Item key={0} index={0} />]}
                style={{ height: width, padding: 20 }}
                offset={offset}
                safeMargin={200}
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
