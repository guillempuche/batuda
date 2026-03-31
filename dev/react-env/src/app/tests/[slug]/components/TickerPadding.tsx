"use client"

import { Ticker, useTicker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Padding
 */

function Item({ index }: { index: number }) {
    const { maxInset } = useTicker()
    return (
        <div
            style={{
                width: "100px",
                height: "100px",
                backgroundColor: `hsl(${index * 30}, 100%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
            }}
        >
            {maxInset}
        </div>
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
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            <Ticker
                id="x"
                items={[<Item key={0} index={0} />]}
                style={{ width, padding: 20 }}
                offset={offset}
            />
            <Ticker
                id="x-loop-disabled"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                    <Item key={6} index={6} />,
                    <Item key={7} index={7} />,
                    <Item key={8} index={8} />,
                    <Item key={9} index={9} />,
                    <Item key={10} index={10} />,
                    <Item key={11} index={11} />,
                ]}
                style={{ width, padding: 200 }}
                offset={offset}
                loop={false}
                drag="x"
            />
            <Ticker
                id="y"
                axis="y"
                items={[<Item key={0} index={0} />]}
                style={{ height: width, padding: 20 }}
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
