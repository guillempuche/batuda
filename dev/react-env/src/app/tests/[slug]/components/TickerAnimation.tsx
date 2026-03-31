"use client"

import { Ticker } from "motion-plus/react"

/**
 * Title: Ticker: Animation
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
    return (
        <div style={{ display: "flex", gap: "10px", flexDirection: "column" }}>
            {/* Example of autoplaying */}
            <Ticker
                id="autoplay"
                items={[<Item key={0} index={0} />, <Item key={1} index={1} />]}
                style={{ width: 400 }}
            />
            <div style={{ height: "100vh" }}></div>
            {/* Example of off screen not playing */}
            <Ticker
                id="off-screen"
                items={[<Item key={0} index={0} />, <Item key={1} index={1} />]}
                style={{ width: 400 }}
            />
        </div>
    )
}
