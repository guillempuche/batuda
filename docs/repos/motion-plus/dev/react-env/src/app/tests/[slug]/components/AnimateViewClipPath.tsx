"use client"

import { AnimateView } from "motion-plus/animate-view"
import { startTransition, useState } from "react"

/**
 * Title: AnimateView: Clip path enter/exit
 */

export default function Example() {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <button onClick={() => startTransition(() => setIsOpen(!isOpen))}>
                {isOpen ? "Close" : "Open"}
            </button>
            {isOpen && (
                <AnimateView
                    enter={{
                        // opacity: 0.5,
                        clipPath: ["inset(0 0 100% 0)", "inset(0 0 0% 0)"],
                        transition: { duration: 1 },
                    }}
                    exit={{
                        // opacity: 0.5,
                        clipPath: ["inset(0 0 0% 0)", "inset(0 0 100% 0)"],
                    }}
                    // transition={{ duration: 1 }}
                >
                    <div
                        style={{
                            width: 300,
                            height: 200,
                            background: "hsl(220, 70%, 60%)",
                            borderRadius: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "white",
                            fontSize: 24,
                            fontWeight: "bold",
                        }}
                    >
                        Modal
                    </div>
                </AnimateView>
            )}
        </div>
    )
}
