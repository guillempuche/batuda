"use client"

import { Ticker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Item Size
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
                height: "100px",
                ...style,
                backgroundColor: `hsl(${index * 30}, 100%, 50%)`,
                color: "white",
                justifySelf: "flex-start",
            }}
        />
    )
}

export default function Example() {
    const [width] = useState(520)

    const offset = useMotionValue(0)

    return (
        <div
            style={{
                display: "flex",
                gap: "10px",
                flexDirection: "column",
            }}
        >
            <div
                style={{
                    display: "flex",
                    gap: "10px",
                    flexDirection: "column",
                }}
            >
                <Ticker
                    id="x-start"
                    align="start"
                    items={[
                        <Item key={0} index={0} style={{ width: "100%" }} />,
                        <Item key={1} index={1} style={{ width: "100%" }} />,
                        <Item key={2} index={2} style={{ width: "100%" }} />,
                    ]}
                    offset={offset}
                    style={{ width, padding: 20 }}
                    itemSize="fill"
                />
                <Ticker
                    id="y-start"
                    axis="y"
                    align="start"
                    items={[
                        <Item key={0} index={0} style={{ height: "100%" }} />,
                        <Item key={1} index={1} style={{ height: "100%" }} />,
                        <Item key={2} index={2} style={{ height: "100%" }} />,
                    ]}
                    offset={offset}
                    style={{ height: width, width: "100px", padding: 20 }}
                    itemSize="fill"
                />
            </div>
        </div>
    )
}
