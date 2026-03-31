"use client"

import { Ticker } from "motion-plus/react"
import { useState } from "react"

/**
 * Title: Ticker: Static mode
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
    const [width, setWidth] = useState(520)

    const shiftWidth = () => {
        setWidth(width)
    }

    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            <Ticker
                id="x"
                items={[<Item key={0} index={0} />]}
                style={{ width, padding: 20 }}
                isStatic
            />
            <Ticker
                id="y"
                axis="y"
                items={[<Item key={0} index={0} />]}
                style={{ height: width, padding: 20 }}
                isStatic
            />
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                }}
            >
                <button id="size" onClick={shiftWidth}>
                    Resize
                </button>
            </div>
        </div>
    )
}
