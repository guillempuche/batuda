"use client"

import { AnimateView } from "motion-plus/animate-view"
import { startTransition, useState } from "react"

/**
 * Title: AnimateView: Basic enter/exit
 */

const boxStyle: React.CSSProperties = {
    width: 200,
    height: 200,
    background: "hsl(220, 70%, 60%)",
    borderRadius: 12,
}

export default function Example() {
    const [show, setShow] = useState(true)

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <button onClick={() => startTransition(() => setShow(!show))}>
                Toggle
            </button>
            {show && (
                <AnimateView
                    enter={{ opacity: [0, 1] }}
                    exit={{ opacity: [1, 0] }}
                    transition={{ duration: 0.4 }}
                >
                    <div style={boxStyle} />
                </AnimateView>
            )}
        </div>
    )
}
