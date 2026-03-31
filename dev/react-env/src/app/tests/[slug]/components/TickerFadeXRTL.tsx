"use client"

import { Ticker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useInsertionEffect, useState } from "react"

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
        offset.set(offset.get() + 50)
    }
    useInsertionEffect(() => {
        document.dir = "rtl"
    }, [])

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
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
                style={{ width }}
                offset={offset}
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
                style={{ width }}
                offset={offset}
                fade={10}
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
                style={{ width }}
                offset={offset}
                fade="10%"
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
                style={{ width }}
                offset={offset}
                fade={10}
                loop={false}
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
                    onClick={() => offset.set(offset.get() - 50)}
                >
                    Move Back
                </button>
                <button id="size">Resize</button>
            </div>
        </div>
    )
}
