"use client"

import { Ticker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Cloning and positioning, x-axis
 */

function Item({
    index,
    style,
}: {
    index: number
    style?: React.CSSProperties
}) {
    return (
        <div
            style={{
                width: "100px",
                height: "140px",
                backgroundColor: `hsl(${index * 30}, 100%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
                ...style,
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
        setWidth(width - 200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            <style>
                {`
html, body {
    max-width: 100%;
    overflow-x: hidden;
}
`}
            </style>
            {/* Example of one item */}
            <Ticker
                id="one-item"
                items={[<Item key={0} index={0} />]}
                style={{ width, transform: "scale(0.5)" }}
                overflow
                offset={offset}
            />
            {/* Example of two items */}
            <Ticker
                id="two-items"
                items={[<Item key={0} index={0} />, <Item key={1} index={1} />]}
                style={{ width, transform: "scale(0.5)" }}
                overflow
                offset={offset}
            />
            {/* Example of six items - should have no cloned children */}
            <Ticker
                id="six-items"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                ]}
                style={{ width, transform: "scale(0.5)" }}
                overflow
                offset={offset}
            />
            {/* Example of one item stretched */}
            <Ticker
                id="one-item-stretch"
                items={[<Item key={0} index={0} style={{ width: "100%" }} />]}
                style={{ width, transform: "scale(0.5)" }}
                itemSize="fill"
                overflow
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
