"use client"

import { Cursor, useCursorState } from "motion-plus/react"

/**
 * Title: Cursor: Zone
 */

export default function Example() {
    const { zone } = useCursorState()

    return (
        <div style={container}>
            <div
                style={{ width: 200, height: 200, background: "white" }}
                data-cursor-zone="dark"
                id="white"
            />
            <div
                style={{ width: 200, height: 200, background: "red" }}
                data-cursor-zone="light"
                id="red"
            />
            <Cursor
                id="cursor"
                style={{
                    backgroundColor:
                        zone === null
                            ? "red"
                            : zone === "light"
                            ? "white"
                            : "black",
                }}
            />
        </div>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    width: 600,
    flexDirection: "column",
}
