"use client"

import { Cursor } from "motion-plus/react"

/**
 * Title: Cursor: Options
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
                    data-testid="cursor"
                    matchTextSize={false}
                    style={{ backgroundColor: "#0f0" }}
                    variants={{
                        default: { opacity: 0.9, scale: 1 },
                        pointer: { backgroundColor: "#f00" },
                        exit: { opacity: 0.1 },
                        pressed: { scale: 0.5 },
                    }}
                />
                <Cursor
                    follow
                    spring={false}
                    center={{ x: 1, y: 1 }}
                    offset={{ x: -100, y: -100 }}
                >
                    <div
                        data-testid="follow"
                        style={{ width: 100, height: 100, background: "#fff" }}
                    />
                </Cursor>
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
