"use client"

import { Cursor } from "motion-plus/react"

/**
 * Title: Cursor: Disable size matching
 */

export default function Example() {
    return (
        <div style={container}>
            <div style={targetsContainer}>
                <button data-testid="pointer-target">Test button</button>
                <h2 data-testid="h2" style={{ fontSize: 48 }}>
                    Hello
                </h2>
                <h3 data-testid="h3" style={{ fontSize: 32 }}>
                    Hello
                </h3>
                <h4
                    data-cursor="custom"
                    data-cursor-data=""
                    data-testid="h4"
                    style={{ fontSize: 24 }}
                >
                    Hello
                </h4>
                <h5 data-testid="h5" style={{ fontSize: 16 }}>
                    <div style={{ fontSize: 52 }}> Hello</div>
                </h5>
                <Cursor
                    data-testid="follow-cursor"
                    follow
                    spring={false}
                    center={{ x: 1, y: 1 }}
                    offset={{ x: -100, y: -100 }}
                    style={{ backgroundColor: "red" }}
                />
            </div>
        </div>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    width: 600,
    flexDirection: "column",
}

const targetsContainer: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
}
