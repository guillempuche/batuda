"use client"

import { Ticker, useTickerItem } from "motion-plus/react"
import { motion, useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Cloning and positioning, x-axis
 */

function Item({ index }: { index: number }) {
    const { props } = useTickerItem()
    return (
        <motion.li
            {...props}
            style={{
                ...props.style,
                width: `${(index + 1) * 10}%`,
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
    const [width, setWidth] = useState(520)

    const shiftOffset = () => {
        offset.set(offset.get() - 100)
    }

    const shiftWidth = () => {
        setWidth(width - 200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            {/* Example of one item */}
            <Ticker
                id="one-item"
                items={[<Item key={0} index={0} />]}
                style={{ width }}
                offset={offset}
                itemSize="manual"
            />
            {/* Example of two items */}
            <Ticker
                id="two-items"
                items={[<Item key={0} index={0} />, <Item key={1} index={1} />]}
                style={{ width }}
                offset={offset}
                itemSize="manual"
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
                style={{ width }}
                offset={offset}
                itemSize="manual"
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
