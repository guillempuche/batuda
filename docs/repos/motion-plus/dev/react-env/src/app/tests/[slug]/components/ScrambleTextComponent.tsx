"use client"

import { ScrambleText } from "motion-plus/react"
import { stagger } from "motion/react"
import { useState } from "react"

/**
 * Title: ScrambleText: React component
 */

export default function ScrambleTextComponentTest() {
    const [text, setText] = useState("Hello World!")
    const [active, setActive] = useState(true)
    const [duration, setDuration] = useState(1)
    const [useStagger, setUseStagger] = useState(false)
    const [staggerAmount, setStaggerAmount] = useState(0.05)
    const [useInfinity, setUseInfinity] = useState(false)
    const [completed, setCompleted] = useState(false)

    const getDuration = () => {
        if (useInfinity) return Infinity
        if (useStagger) return stagger(staggerAmount, { startDelay: duration })
        return duration
    }

    return (
        <div style={{ padding: 20, fontFamily: "monospace", fontSize: 18 }}>
            <h2>ScrambleText Component</h2>

            <div
                style={{
                    margin: "20px 0",
                    padding: "20px",
                    borderRadius: "8px",
                    border: "2px solid #e0e0e0",
                    minHeight: 80,
                }}
            >
                <ScrambleText
                    as="h3"
                    active={active}
                    duration={getDuration()}
                    onComplete={() => {
                        console.log("Complete!")
                        setCompleted(true)
                    }}
                    data-testid="scramble-text"
                >
                    {text}
                </ScrambleText>

                <p style={{ marginTop: 10, fontSize: 14, color: "#666" }}>
                    Status: {completed ? "Complete" : active ? "Scrambling" : "Idle"}
                </p>
            </div>

            <div style={{ marginTop: 40 }}>
                <div style={{ marginBottom: 15 }}>
                    <label style={{ display: "block", marginBottom: 5 }}>Text:</label>
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => {
                            setText(e.target.value)
                            setCompleted(false)
                        }}
                        style={{ width: "100%", maxWidth: 400, padding: 8 }}
                    />
                </div>

                <div style={{ marginBottom: 15 }}>
                    <label>
                        <input
                            type="checkbox"
                            checked={active}
                            onChange={(e) => {
                                setActive(e.target.checked)
                                setCompleted(false)
                            }}
                        />
                        {" "}Active
                    </label>
                </div>

                <div style={{ marginBottom: 15 }}>
                    <label>
                        Duration (s):{" "}
                        <input
                            type="number"
                            value={duration}
                            onChange={(e) => setDuration(Number(e.target.value))}
                            min="0"
                            max="10"
                            step="0.1"
                            style={{ width: 80 }}
                            disabled={useInfinity}
                        />
                    </label>
                </div>

                <div style={{ marginBottom: 15 }}>
                    <label>
                        <input
                            type="checkbox"
                            checked={useStagger}
                            onChange={(e) => setUseStagger(e.target.checked)}
                            disabled={useInfinity}
                        />
                        {" "}Use stagger (reveals chars one by one)
                    </label>
                    {useStagger && (
                        <div style={{ marginLeft: 20, marginTop: 5 }}>
                            <label>
                                Stagger amount:{" "}
                                <input
                                    type="number"
                                    value={staggerAmount}
                                    onChange={(e) => setStaggerAmount(Number(e.target.value))}
                                    min="0.01"
                                    max="0.5"
                                    step="0.01"
                                    style={{ width: 80 }}
                                />
                            </label>
                        </div>
                    )}
                </div>

                <div style={{ marginBottom: 15 }}>
                    <label>
                        <input
                            type="checkbox"
                            checked={useInfinity}
                            onChange={(e) => {
                                setUseInfinity(e.target.checked)
                                if (e.target.checked) setUseStagger(false)
                            }}
                        />
                        {" "}Infinite duration (toggle active to reveal)
                    </label>
                </div>

                <button
                    onClick={() => {
                        setActive(false)
                        setTimeout(() => {
                            setActive(true)
                            setCompleted(false)
                        }, 100)
                    }}
                    style={{ padding: "8px 16px" }}
                >
                    Restart
                </button>
            </div>
        </div>
    )
}
