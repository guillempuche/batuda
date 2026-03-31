"use client"

import { spring } from "motion"
import { AnimateView } from "motion-plus/animate-view"
import { startTransition, useState } from "react"

/**
 * Title: AnimateView: List reorder
 */

const initialItems = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    color: `hsl(${i * 45}, 70%, 60%)`,
    label: `Item ${i + 1}`,
}))

export default function Example() {
    const [items, setItems] = useState(initialItems)

    const shuffle = () => {
        startTransition(() => {
            setItems((prev) => [...prev.sort(() => Math.random() - 0.5)])
        })
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 20,
            }}
        >
            <button onClick={shuffle}>Shuffle</button>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((item) => (
                    <AnimateView
                        key={item.id}
                        transition={{
                            type: spring,
                            visualDuration: 0.3,
                            bounce: 0.2,
                        }}
                    >
                        <div
                            style={{
                                width: 200,
                                height: 40,
                                background: item.color,
                                borderRadius: 8,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: "bold",
                                color: "rgba(0,0,0,0.3)",
                            }}
                        >
                            {item.label}
                        </div>
                    </AnimateView>
                ))}
            </div>
        </div>
    )
}
