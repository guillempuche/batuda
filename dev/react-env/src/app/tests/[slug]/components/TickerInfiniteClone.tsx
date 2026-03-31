"use client"

import { Ticker } from "motion-plus/react"

/**
 * Title: Ticker: Infinite Clones
 *
 * An example of using an unbounded parent so that the ticker ends up
 * sized according to the number of items. This could trigger an infinite
 * render loop when we clone items - this test file ensures that it doesn't.
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
                id="infinite-clone"
                items={[<Item key={0} index={0} />, <Item key={1} index={1} />]}
            />
        </div>
    )
}
