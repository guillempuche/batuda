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
    const [width, setWidth] = useState(520)

    const shiftOffset = () => {
        offset.set(offset.get() - 100)
    }

    const shiftWidth = () => {
        setWidth(width - 200)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "row" }}>
            <Ticker
                id="fade-none"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                ]}
                style={{ height: width }}
                offset={offset}
                axis="y"
            />
            <Ticker
                id="fade-px"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                ]}
                style={{ height: width }}
                offset={offset}
                fade={10}
                axis="y"
            />
            <Ticker
                id="fade-percent"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                ]}
                style={{ height: width }}
                offset={offset}
                fade="10%"
                axis="y"
            />
            <Ticker
                id="fade-edge"
                items={[
                    <Item key={0} index={0} />,
                    <Item key={1} index={1} />,
                    <Item key={2} index={2} />,
                    <Item key={3} index={3} />,
                    <Item key={4} index={4} />,
                    <Item key={5} index={5} />,
                ]}
                style={{ height: width }}
                offset={offset}
                fade={10}
                loop={false}
                axis="y"
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
                <button
                    id="move-back"
                    onClick={() => offset.set(offset.get() + 100)}
                >
                    Move Back
                </button>
                <button id="size" onClick={shiftWidth}>
                    Resize
                </button>
            </div>
        </div>
    )
}
