"use client"

import { scrambleText, ScrambleTextControls } from "motion-plus-dom"
import { stagger } from "motion/react"
import { useEffect, useRef, useState } from "react"

/**
 * Title: ScrambleText: DOM function
 */

export default function ScrambleTextDOMTest() {
    const textRef = useRef<HTMLHeadingElement>(null)
    const controlsRef = useRef<ScrambleTextControls | null>(null)

    const [text, setText] = useState("Hello World!")
    const [delay, setDelay] = useState(0)
    const [duration, setDuration] = useState(1)
    const [interval, setIntervalValue] = useState(0.05)
    const [useStaggerDelay, setUseStaggerDelay] = useState(false)
    const [useStaggerDuration, setUseStaggerDuration] = useState(false)
    const [staggerAmount, setStaggerAmount] = useState(0.05)
    const [useInfinity, setUseInfinity] = useState(false)
    const [status, setStatus] = useState("idle")

    const getDelay = () => {
        if (useStaggerDelay) return stagger(staggerAmount)
        return delay
    }

    const getDuration = () => {
        if (useInfinity) return Infinity
        if (useStaggerDuration) return stagger(staggerAmount, { startDelay: duration })
        return duration
    }

    const runScramble = () => {
        if (!textRef.current) return

        // Stop any existing animation
        controlsRef.current?.stop()

        // Reset text content
        textRef.current.textContent = text
        setStatus("scrambling")

        controlsRef.current = scrambleText(textRef.current, {
            delay: getDelay(),
            duration: getDuration(),
            interval: interval,
            onComplete: () => {
                console.log("Complete!")
                setStatus("complete")
            },
        })
    }

    const stopScramble = () => {
        controlsRef.current?.stop()
        setStatus("stopped")
    }

    useEffect(() => {
        return () => {
            controlsRef.current?.stop()
        }
    }, [])

    return (
        <div style={{ padding: 20, fontFamily: "monospace", fontSize: 18 }}>
            <h2>scrambleText DOM Function</h2>

            <div
                style={{
                    margin: "20px 0",
                    padding: "20px",
                    borderRadius: "8px",
                    border: "2px solid #e0e0e0",
                    minHeight: 80,
                }}
            >
                <h3 ref={textRef} data-testid="scramble-text">
                    {text}
                </h3>

                <p style={{ marginTop: 10, fontSize: 14, color: "#666" }}>
                    Status: {status}
                </p>
            </div>

            <div style={{ marginTop: 40 }}>
                <div style={{ marginBottom: 15 }}>
                    <label style={{ display: "block", marginBottom: 5 }}>Text:</label>
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        style={{ width: "100%", maxWidth: 400, padding: 8 }}
                    />
                </div>

                <h4>Timing Controls</h4>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Delay (s):{" "}
                        <input
                            type="number"
                            value={delay}
                            onChange={(e) => setDelay(Number(e.target.value))}
                            min="0"
                            max="5"
                            step="0.1"
                            style={{ width: 80 }}
                            disabled={useStaggerDelay}
                        />
                    </label>
                    <label style={{ marginLeft: 15 }}>
                        <input
                            type="checkbox"
                            checked={useStaggerDelay}
                            onChange={(e) => setUseStaggerDelay(e.target.checked)}
                        />
                        {" "}Use stagger
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
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
                            disabled={useStaggerDuration || useInfinity}
                        />
                    </label>
                    <label style={{ marginLeft: 15 }}>
                        <input
                            type="checkbox"
                            checked={useStaggerDuration}
                            onChange={(e) => {
                                setUseStaggerDuration(e.target.checked)
                                if (e.target.checked) setUseInfinity(false)
                            }}
                        />
                        {" "}Use stagger
                    </label>
                    <label style={{ marginLeft: 15 }}>
                        <input
                            type="checkbox"
                            checked={useInfinity}
                            onChange={(e) => {
                                setUseInfinity(e.target.checked)
                                if (e.target.checked) setUseStaggerDuration(false)
                            }}
                        />
                        {" "}Infinite
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Stagger amount (s):{" "}
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

                <div style={{ marginBottom: 15 }}>
                    <label>
                        Interval (s):{" "}
                        <input
                            type="number"
                            value={interval}
                            onChange={(e) => setIntervalValue(Number(e.target.value))}
                            min="0.01"
                            max="0.5"
                            step="0.01"
                            style={{ width: 80 }}
                        />
                    </label>
                    <span style={{ marginLeft: 10, fontSize: 14, color: "#666" }}>
                        (time between char changes)
                    </span>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={runScramble} style={{ padding: "8px 16px" }}>
                        Play
                    </button>
                    <button onClick={stopScramble} style={{ padding: "8px 16px" }}>
                        Stop
                    </button>
                </div>
            </div>
        </div>
    )
}
