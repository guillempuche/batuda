"use client"

import { spring } from "motion"
import { AnimateView } from "motion-plus/animate-view"
import { startTransition, useState } from "react"

/**
 * Title: AnimateView: Shared element transition
 */

const items = Array.from({ length: 6 }, (_, i) => ({
    id: i,
    color: `hsl(${i * 60}, 70%, 60%)`,
}))

export default function Example() {
    const [selectedId, setSelectedId] = useState<number | undefined>(undefined)

    return (
        <div style={{ position: "relative", width: 400, height: 400 }}>
            {selectedId !== undefined ? (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(0,0,0,0.5)",
                        zIndex: 10,
                    }}
                    onClick={() =>
                        startTransition(() => setSelectedId(undefined))
                    }
                >
                    <AnimateView
                        name={`item-${selectedId}`}
                        transition={{
                            type: spring,
                            visualDuration: 0.4,
                            bounce: 0.3,
                        }}
                    >
                        <div
                            style={{
                                width: 300,
                                height: 300,
                                background: items[selectedId].color,
                                borderRadius: 16,
                            }}
                        />
                    </AnimateView>
                </div>
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 100px)",
                        gap: 12,
                    }}
                >
                    {items.map((item) => (
                        <AnimateView
                            key={item.id}
                            name={`item-${item.id}`}
                            transition={{
                                type: spring,
                                visualDuration: 0.4,
                                bounce: 0.3,
                            }}
                        >
                            <div
                                style={{
                                    width: 100,
                                    height: 100,
                                    background: item.color,
                                    borderRadius: 8,
                                    cursor: "pointer",
                                }}
                                onClick={() =>
                                    startTransition(() =>
                                        setSelectedId(item.id)
                                    )
                                }
                            />
                        </AnimateView>
                    ))}
                </div>
            )}
        </div>
    )
}
