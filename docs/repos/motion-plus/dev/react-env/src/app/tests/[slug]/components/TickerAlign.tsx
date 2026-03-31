"use client"

import { Ticker } from "motion-plus/react"
import { useMotionValue } from "motion/react"
import { useState } from "react"

/**
 * Title: Ticker: Align
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
                        <Item key={0} index={0} style={{ height: 100 }} />,
                        <Item key={1} index={1} style={{ height: 150 }} />,
                        <Item key={2} index={2} style={{ height: 50 }} />,
                    ]}
                    offset={offset}
                    style={{ width, padding: 20 }}
                />
                <Ticker
                    id="x-center"
                    items={[
                        <Item key={0} index={0} style={{ height: 100 }} />,
                        <Item key={1} index={1} style={{ height: 150 }} />,
                        <Item key={2} index={2} style={{ height: 50 }} />,
                    ]}
                    align="center"
                    offset={offset}
                    style={{ width, padding: 20 }}
                />
                <Ticker
                    id="x-end"
                    items={[
                        <Item key={0} index={0} style={{ height: 100 }} />,
                        <Item key={1} index={1} style={{ height: 150 }} />,
                        <Item key={2} index={2} style={{ height: 50 }} />,
                    ]}
                    align="end"
                    offset={offset}
                    style={{ width, padding: 20, height: 100 }}
                />
                <Ticker
                    id="x-stretch"
                    items={[
                        <Item key={0} index={0} style={{ height: "100%" }} />,
                        <Item key={1} index={1} style={{ height: "100%" }} />,
                        <Item key={2} index={2} style={{ height: "100%" }} />,
                    ]}
                    align="stretch"
                    offset={offset}
                    style={{ width, padding: 20, height: 100 }}
                />
            </div>
            <div style={{ display: "flex", gap: "10px", flexDirection: "row" }}>
                <Ticker
                    id="y-start"
                    axis="y"
                    align="start"
                    items={[
                        <Item key={0} index={0} style={{ width: 100 }} />,
                        <Item key={1} index={1} style={{ width: 150 }} />,
                        <Item key={2} index={2} style={{ width: 50 }} />,
                    ]}
                    offset={offset}
                    style={{ height: width, padding: 20 }}
                />
                <Ticker
                    id="y-center"
                    axis="y"
                    items={[
                        <Item key={0} index={0} style={{ width: 100 }} />,
                        <Item key={1} index={1} style={{ width: 150 }} />,
                        <Item key={2} index={2} style={{ width: 50 }} />,
                    ]}
                    align="center"
                    offset={offset}
                    style={{ height: width, padding: 20 }}
                />
                <Ticker
                    id="y-end"
                    axis="y"
                    items={[
                        <Item key={0} index={0} style={{ width: 100 }} />,
                        <Item key={1} index={1} style={{ width: 150 }} />,
                        <Item key={2} index={2} style={{ width: 50 }} />,
                    ]}
                    align="end"
                    offset={offset}
                    style={{ height: width, padding: 20 }}
                />
                <Ticker
                    id="y-stretch"
                    axis="y"
                    items={[
                        <Item key={0} index={0} />,
                        <Item key={1} index={1} />,
                        <Item key={2} index={2} />,
                    ]}
                    align="stretch"
                    offset={offset}
                    style={{ height: width, padding: 20 }}
                />
            </div>
        </div>
    )
}
