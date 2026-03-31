"use client"

import { AnimateNumber } from "motion-plus/react"
import { MotionConfig } from "motion/react"
import * as motion from "motion/react-client"
import { useState } from "react"

export default function App() {
    const [toggleOuter, setToggleOuter] = useState(true)
    const [toggleInner, setToggleInner] = useState(true)

    return (
        <MotionConfig transition={{ duration: 10 }}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    width: 200,
                }}
            >
                <button
                    id="toggle"
                    onClick={() => setToggleOuter(!toggleOuter)}
                >
                    Outer toggle
                </button>

                {toggleOuter ? (
                    <div style={{ height: 200, background: "grey" }} />
                ) : null}

                <motion.div
                    style={{
                        background: "black",
                        color: "purple",
                        fontSize: 32,
                        padding: 16,
                        borderRadius: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    <button onClick={() => setToggleInner(!toggleInner)}>
                        Inner toggle
                    </button>

                    <motion.div
                        layout
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            background: "blue",
                            placeSelf: toggleInner ? "start" : "end",
                        }}
                    />

                    <motion.div
                        layoutDependency={toggleInner}
                        id="box-layout-dependency"
                        layout
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            background: "red",
                            placeSelf: toggleInner ? "start" : "end",
                        }}
                    />

                    <motion.div
                        layout
                        layoutRoot
                        id="box-layout-root"
                        style={{
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <motion.div
                            layout
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 8,
                                background: "green",
                                placeSelf: toggleInner ? "start" : "end",
                            }}
                        />
                    </motion.div>

                    <AnimateNumber style={{ color: "blue" }}>
                        {toggleInner ? 999 : 0}
                    </AnimateNumber>

                    <AnimateNumber
                        layoutDependency={toggleInner}
                        style={{ color: "red" }}
                        id="number-layout-dependency"
                    >
                        {toggleInner ? 999 : 0}
                    </AnimateNumber>

                    <motion.div
                        layout
                        layoutRoot
                        style={{
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <AnimateNumber
                            id="number-layout-root"
                            style={{ color: "green" }}
                        >
                            {toggleInner ? 999 : 0}
                        </AnimateNumber>
                    </motion.div>
                </motion.div>
                <style>{`
              body { 
                overflow: hidden;
              }
            `}</style>
            </div>
        </MotionConfig>
    )
}
