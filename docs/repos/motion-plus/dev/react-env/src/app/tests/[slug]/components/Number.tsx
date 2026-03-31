"use client"

import { AnimateNumber } from "motion-plus/react"
import { useState } from "react"

/**
 * Title: Number
 */

export default function Example() {
    const [value, setValue] = useState(10)

    return (
        <div style={container}>
            <button onClick={() => setValue(20)}>Up</button>
            <button onClick={() => setValue(0)}>Down</button>
            <AnimateNumber
                locales="en-US"
                format={{
                    notation: "compact",
                    compactDisplay: "short",
                    roundingMode: "trunc",
                    currency: "USD",
                    style: "currency",
                }}
                style={number}
                suffix="/mo"
            >
                {value}
            </AnimateNumber>
            <style>{`
                .number-section-post {
                    font-size: 12px;
                    opacity: 0.5;
                    align-items: flex-end;
                    position: relative;
                    bottom: 10px;
                }
            `}</style>
        </div>
    )
}

const container: React.CSSProperties = {
    display: "flex",
    width: 600,
    flexDirection: "column",
}

const number: React.CSSProperties = {
    fontSize: 48,
}
