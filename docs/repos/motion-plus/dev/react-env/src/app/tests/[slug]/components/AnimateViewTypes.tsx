"use client"

import { spring, wrap } from "motion"
import { AnimateView } from "motion-plus/animate-view"
import {
    addTransitionType,
    startTransition,
    useState,
} from "react"

/**
 * Title: AnimateView: Transition types (prev/next)
 */

const colors = [
    "hsl(0, 70%, 60%)",
    "hsl(60, 70%, 60%)",
    "hsl(120, 70%, 60%)",
    "hsl(180, 70%, 60%)",
    "hsl(240, 70%, 60%)",
    "hsl(300, 70%, 60%)",
]

export default function Example() {
    const [index, setIndex] = useState(0)

    const navigate = (direction: "next" | "prev") => {
        startTransition(() => {
            addTransitionType(direction)
            setIndex(
                wrap(0, colors.length, index + (direction === "next" ? 1 : -1))
            )
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
            <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => navigate("prev")}>Prev</button>
                <span>
                    {index + 1} / {colors.length}
                </span>
                <button onClick={() => navigate("next")}>Next</button>
            </div>
            <AnimateView
                key={index}
                name={`slide-${index}`}
                transition={{
                    type: spring,
                    visualDuration: 0.3,
                    bounce: 0.2,
                }}
                exit={(types) => ({
                    opacity: [1, 0],
                    transform: `translateX(${
                        types.includes("prev") ? 100 : -100
                    }%)`,
                })}
                enter={(types) => ({
                    opacity: [0, 1],
                    transform: [
                        `translateX(${
                            types.includes("next") ? 100 : -100
                        }%)`,
                        "translateX(0%)",
                    ],
                })}
            >
                <div
                    style={{
                        width: 300,
                        height: 200,
                        background: colors[index],
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 48,
                        fontWeight: "bold",
                        color: "rgba(0,0,0,0.3)",
                    }}
                >
                    {index + 1}
                </div>
            </AnimateView>
        </div>
    )
}
