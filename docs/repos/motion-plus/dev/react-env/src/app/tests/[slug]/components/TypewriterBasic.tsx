"use client"

import { Typewriter, type TypingSpeed } from "motion-plus/react"
import { useState } from "react"

/**
 * Title: Typewriter: Basic typing animation
 */

export default function TypewriterBasic() {
    const [text, setText] = useState(
        "Hello world! This is a typewriter effect."
    )
    const [speed, setSpeed] = useState<TypingSpeed>("fast")
    const [variance, setVariance] = useState<number | "natural">("natural")
    const [blinkDuration, setBlinkDuration] = useState(0.5)
    const [blinkRepeat, setBlinkRepeat] = useState(Infinity)
    const [customCursor, setCustomCursor] = useState(false)
    const [ariaLabel, setAriaLabel] = useState("")
    const [play, setPlay] = useState(true)
    const [replace, setReplace] = useState<"all" | "type">("type")
    const [backspaceFactor, setBackspaceFactor] = useState(0.2)
    const [backspace, setBackspace] = useState<"character" | "word" | "all">(
        "character"
    )

    return (
        <div style={{ padding: 20, fontFamily: "monospace", fontSize: 18 }}>
            <h2>Typewriter Component</h2>

            <div
                style={{
                    margin: "20px 0",
                    padding: "20px",
                    borderRadius: "8px",
                    border: "2px solid #e0e0e0",
                }}
            >
                <Typewriter
                    as="h3"
                    speed={speed}
                    variance={variance}
                    cursorBlinkDuration={blinkDuration}
                    cursorBlinkRepeat={blinkRepeat}
                    cursorClassName={customCursor ? "custom-cursor" : undefined}
                    cursorStyle={
                        customCursor
                            ? {
                                  backgroundColor: "red",
                                  width: "3px",
                                  borderRadius: "1px",
                              }
                            : undefined
                    }
                    aria-label={ariaLabel || undefined}
                    onComplete={() => console.log("Typing completed!")}
                    play={play}
                    replace={replace}
                    backspaceFactor={backspaceFactor}
                    backspace={backspace}
                    style={{
                        width: "100%",
                    }}
                    id="typewriter"
                >
                    {text}
                </Typewriter>
                <Typewriter
                    as="p"
                    speed={40}
                    variance="natural"
                    cursorBlinkDuration={blinkDuration}
                    cursorBlinkRepeat={blinkRepeat}
                    cursorClassName={customCursor ? "custom-cursor" : undefined}
                    cursorStyle={
                        customCursor
                            ? {
                                  backgroundColor: "red",
                                  width: "3px",
                                  borderRadius: "1px",
                              }
                            : undefined
                    }
                    aria-label={ariaLabel || undefined}
                    onComplete={() => console.log("Typing completed!")}
                    play={play}
                    replace={replace}
                    backspaceFactor={backspaceFactor}
                    backspace={backspace}
                    style={{
                        width: "100%",
                    }}
                    id="typewriter"
                >
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed
                    do eiusmod tempor incididunt ut. labore et dolore magna
                    aliqua. Lorem ipsum dolor sit amet, consectetur adipiscing
                    elit. Sed do eiusmod tempor incididunt. ut labore et dolore
                    magna aliqua. Lorem ipsum dolor sit amet, consectetur
                    adipiscing elit. Sed do eiusmod tempor incididunt ut labore
                    et dolore magna aliqua.
                </Typewriter>
            </div>

            <div style={{ marginTop: 40 }}>
                <h4>Content Controls</h4>

                <div style={{ marginBottom: 15 }}>
                    <label style={{ display: "block", marginBottom: 5 }}>
                        Text:
                    </label>
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        style={{ width: "100%", maxWidth: 400, padding: 8 }}
                    />
                </div>

                <div style={{ marginBottom: 15 }}>
                    <label style={{ display: "block", marginBottom: 5 }}>
                        Quick examples (to test smart backspace):
                    </label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                            onClick={() => setText("Hello world")}
                            style={{ padding: "4px 8px" }}
                        >
                            &quot;Hello world&quot;
                        </button>
                        <button
                            onClick={() => setText("Hello world!!!")}
                            style={{ padding: "4px 8px" }}
                        >
                            &quot;Hello world!!!&quot;
                        </button>
                        <button
                            onClick={() => setText("Hello universe")}
                            style={{ padding: "4px 8px" }}
                        >
                            &quot;Hello universe&quot;
                        </button>
                        <button
                            onClick={() => setText("We create friends")}
                            style={{ padding: "4px 8px" }}
                        >
                            &quot;We create friends&quot;
                        </button>
                        <button
                            onClick={() => setText("We create mascots")}
                            style={{ padding: "4px 8px" }}
                        >
                            &quot;We create mascots&quot;
                        </button>
                    </div>
                </div>

                <div style={{ marginBottom: 15 }}>
                    <label style={{ display: "block", marginBottom: 5 }}>
                        Play:
                    </label>
                    <input
                        id="play"
                        type="checkbox"
                        checked={play}
                        onChange={(e) => setPlay(e.target.checked)}
                    />
                </div>

                <div style={{ marginBottom: 15 }}>
                    <label style={{ display: "block", marginBottom: 5 }}>
                        Custom ARIA Label (optional):
                    </label>
                    <input
                        type="text"
                        value={ariaLabel}
                        onChange={(e) => setAriaLabel(e.target.value)}
                        placeholder="Leave empty to use text content"
                        style={{ width: "100%", maxWidth: 400, padding: 8 }}
                    />
                </div>

                <h4>Animation Controls</h4>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Typing Speed:
                        <select
                            value={speed}
                            onChange={(e) =>
                                setSpeed(e.target.value as TypingSpeed)
                            }
                            style={{ marginLeft: 10 }}
                        >
                            <option value="slow">Slow (130ms per char)</option>
                            <option value="normal">
                                Normal (75ms per char)
                            </option>
                            <option value="fast">Fast (30ms per char)</option>
                        </select>
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Variance:
                        <select
                            value={variance}
                            onChange={(e) =>
                                setVariance(
                                    e.target.value === "natural"
                                        ? "natural"
                                        : Number(e.target.value)
                                )
                            }
                            style={{ marginLeft: 10 }}
                        >
                            <option value={0}>None (0%)</option>
                            <option value={15}>Low (±15%)</option>
                            <option value={25}>Medium (±25%)</option>
                            <option value={40}>High (±40%)</option>
                            <option value="natural">
                                Natural (human-like)
                            </option>
                        </select>
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Blink delay (s):
                        <input
                            type="number"
                            value={blinkDuration}
                            onChange={(e) =>
                                setBlinkDuration(Number(e.target.value))
                            }
                            min="0"
                            max="3"
                            step="0.1"
                            style={{ marginLeft: 10, width: 100 }}
                        />
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Blink repeat:
                        <input
                            type="number"
                            value={blinkRepeat}
                            onChange={(e) =>
                                setBlinkRepeat(Number(e.target.value))
                            }
                            min="0"
                            step="1"
                            style={{ marginInline: 10, width: 100 }}
                            disabled={blinkRepeat === Infinity}
                        />
                    </label>
                    <label>
                        <input type={"checkbox"} checked={blinkRepeat === Infinity} onChange={(e) => setBlinkRepeat(e.target.checked ? Infinity : 3)} />
                        Blink Infinitely
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Text replace mode:
                        <select
                            value={replace}
                            onChange={(e) =>
                                setReplace(e.target.value as "all" | "type")
                            }
                            style={{ marginLeft: 10 }}
                        >
                            <option value="type">Type animation</option>
                            <option value="all">Replace instantly</option>
                        </select>
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Backspace factor:
                        <input
                            type="number"
                            value={backspaceFactor}
                            onChange={(e) =>
                                setBackspaceFactor(Number(e.target.value))
                            }
                            min="0.1"
                            max="2"
                            step="0.1"
                            style={{ marginLeft: 10, width: 100 }}
                        />
                    </label>
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        Backspace mode (when using smart backspace):
                        <select
                            value={backspace}
                            onChange={(e) =>
                                setBackspace(
                                    e.target.value as
                                        | "character"
                                        | "word"
                                        | "all"
                                )
                            }
                            style={{ marginLeft: 10 }}
                        >
                            <option value="character">
                                Character by character
                            </option>
                            <option value="word">Word by word</option>
                            <option value="all">Jump to common prefix</option>
                        </select>
                    </label>
                </div>

                <h4>Style</h4>

                <div style={{ marginBottom: 10 }}>
                    <label>
                        <input
                            type="checkbox"
                            checked={customCursor}
                            onChange={(e) => setCustomCursor(e.target.checked)}
                        />
                        Custom cursor style
                    </label>
                </div>
            </div>
        </div>
    )
}
