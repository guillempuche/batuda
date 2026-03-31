"use client"

import { AnimateNumber } from "motion-plus/react"
import { useState } from "react"

const transition = {
    y: { type: "spring", duration: 0.5, bounce: 0 },
    width: { type: "spring", duration: 0.3, bounce: 0 },
    opacity: { duration: 0.3 },
} as const

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 14, color: "#888", minWidth: 200 }}>{label}</span>
            {children}
        </div>
    )
}

export default function NumberBasic() {
    const [value, setValue] = useState(5)

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 48 }}>
            <div style={{ display: "flex", gap: 8 }}>
                <button id="set-0" onClick={() => setValue(0)}>0</button>
                <button id="set-5" onClick={() => setValue(5)}>5</button>
                <button id="set-9" onClick={() => setValue(9)}>9</button>
                <button id="set-42" onClick={() => setValue(42)}>42</button>
                <button id="set-100" onClick={() => setValue(100)}>100</button>
                <button id="set-1000" onClick={() => setValue(1000)}>1000</button>
            </div>

            <Row label="Basic">
                <AnimateNumber
                    id="number-basic"
                    locales="en-US"
                    transition={transition}
                >
                    {value}
                </AnimateNumber>
            </Row>

            <Row label="Currency (USD)">
                <AnimateNumber
                    id="number-currency"
                    locales="en-US"
                    format={{ style: "currency", currency: "USD" }}
                    transition={transition}
                >
                    {value}
                </AnimateNumber>
            </Row>

            <Row label='Prefix "~" + Suffix "/mo"'>
                <AnimateNumber
                    id="number-suffix"
                    suffix="/mo"
                    prefix="~"
                    transition={transition}
                >
                    {value}
                </AnimateNumber>
            </Row>

            <Row label="Trend up (trend=1)">
                <AnimateNumber
                    id="number-trend-up"
                    trend={1}
                    transition={transition}
                >
                    {value}
                </AnimateNumber>
            </Row>

            <Row label="Trend down (trend=-1)">
                <AnimateNumber
                    id="number-trend-down"
                    trend={-1}
                    transition={transition}
                >
                    {value}
                </AnimateNumber>
            </Row>
        </div>
    )
}
