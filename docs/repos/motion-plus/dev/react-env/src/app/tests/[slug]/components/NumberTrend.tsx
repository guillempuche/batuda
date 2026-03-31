"use client"

import { AnimateNumber } from "motion-plus/react"
import { useState } from "react"

export default function NumberTrend() {
    const [value, setValue] = useState(5)

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 48 }}>
            <div>
                <button id="increment" onClick={() => setValue((v) => Math.min(v + 1, 9))}>
                    +
                </button>
                <button id="decrement" onClick={() => setValue((v) => Math.max(v - 1, 0))}>
                    -
                </button>
                <button id="set-0" onClick={() => setValue(0)}>
                    Set 0
                </button>
                <button id="set-9" onClick={() => setValue(9)}>
                    Set 9
                </button>
                <button id="set-5" onClick={() => setValue(5)}>
                    Set 5
                </button>
            </div>

            <div>
                <span>Auto: </span>
                <AnimateNumber
                    id="number-auto"
                    transition={{ y: { duration: 0.5 }, width: { duration: 0.3 }, opacity: { duration: 0.3 } }}
                >
                    {value}
                </AnimateNumber>
            </div>

            <div>
                <span>Trend up: </span>
                <AnimateNumber
                    id="number-trend-up"
                    trend={1}
                    transition={{ y: { duration: 0.5 }, width: { duration: 0.3 }, opacity: { duration: 0.3 } }}
                >
                    {value}
                </AnimateNumber>
            </div>

            <div>
                <span>Trend down: </span>
                <AnimateNumber
                    id="number-trend-down"
                    trend={-1}
                    transition={{ y: { duration: 0.5 }, width: { duration: 0.3 }, opacity: { duration: 0.3 } }}
                >
                    {value}
                </AnimateNumber>
            </div>
        </div>
    )
}
