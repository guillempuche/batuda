"use client"

import { Ticker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Cloning and positioning, x-axis
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
        />
    )
}

export default function Example() {
    const offset = useMotionValue(0)
    const [height, setHeight] = useState(520)

    const shiftOffset = () => {
        offset.set(offset.get() - 100)
    }

    const shiftHeight = () => {
        setHeight(height - 200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "row" }}>
            {/* Example of one item */}
            <Ticker
                id="one-item"
                axis="y"
                items={[<Item key={0} index={0} />]}
                style={{ height }}
                offset={offset}
            />
            {/* Example of two items */}
            <Ticker
                id="two-items"
                axis="y"
                items={[<Item key={0} index={0} />, <Item key={1} index={1} />]}
                style={{ height }}
                offset={offset}
            />
            {/* Example of six items - should have no cloned children */}
            <Ticker
                id="six-items"
                axis="y"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                ]}
                style={{ height }}
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
                <button id="size" onClick={shiftHeight}>
                    Resize
                </button>
            </div>
        </div>
    )
}
